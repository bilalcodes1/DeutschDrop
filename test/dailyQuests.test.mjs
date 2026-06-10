import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { ensureDailyQuests, getDailyQuests, updateQuestProgress, claimQuestReward, formatDailyQuestsMessage, getTodayDateBaghdad } from '../dist/services/dailyQuests.js';
import { recordCorrectTrainingAnswer, recordCorrectReviewAnswer, recordTrainingSessionComplete } from '../dist/services/dailyQuestHooks.js';

function createMockD1() {
    const db = new Database(':memory:');
    
    db.exec('CREATE TABLE users (user_id INTEGER PRIMARY KEY);');
    const schema = fs.readFileSync(new URL('../src/db/migrations/0037_daily_quests.sql', import.meta.url), 'utf8');
    db.exec(schema);
    
    db.exec('INSERT INTO users (user_id) VALUES (1);');
    
    // Basic D1 mock
    return {
        prepare: (query) => {
            const stmt = db.prepare(query);
            return {
                bind: (...params) => ({
                    run: async () => stmt.run(...params),
                    all: async () => ({ results: stmt.all(...params) }),
                    first: async () => stmt.get(...params) || null
                })
            };
        },
        _realDb: db // for internal direct checks
    };
}

test('dailyQuests - ensureDailyQuests creates exactly 3 quests and ignores duplicates', async () => {
    const db = createMockD1();
    const userId = 1;
    
    // First call
    await ensureDailyQuests(db, userId);
    let quests = await getDailyQuests(db, userId);
    
    assert.equal(quests.length, 3, 'Should create 3 quests');
    assert.equal(quests.find(q => q.tier === 'bronze').quest_type, 'complete_training_session');
    assert.equal(quests.find(q => q.tier === 'silver').quest_type, 'correct_answers_count');
    assert.equal(quests.find(q => q.tier === 'gold').quest_type, 'perfect_session');
    
    // Second call should not duplicate
    await ensureDailyQuests(db, userId);
    quests = await getDailyQuests(db, userId);
    assert.equal(quests.length, 3, 'Should still be 3 quests after duplicate ensure call');
});

test('dailyQuests - updateQuestProgress increments properly and caps at target', async () => {
    const db = createMockD1();
    const userId = 1;
    
    await ensureDailyQuests(db, userId);
    
    // Test Silver: target is 20
    await updateQuestProgress(db, userId, 'correct_answers_count', 5);
    let quests = await getDailyQuests(db, userId);
    let silver = quests.find(q => q.tier === 'silver');
    assert.equal(silver.current_progress, 5);
    assert.equal(silver.is_completed, 0);
    assert.equal(silver.completed_at, null);
    
    // Increment again by 10 (total 15)
    await updateQuestProgress(db, userId, 'correct_answers_count', 10);
    quests = await getDailyQuests(db, userId);
    silver = quests.find(q => q.tier === 'silver');
    assert.equal(silver.current_progress, 15);
    
    // Increment by 10 (total 25, should cap at 20)
    await updateQuestProgress(db, userId, 'correct_answers_count', 10);
    quests = await getDailyQuests(db, userId);
    silver = quests.find(q => q.tier === 'silver');
    
    assert.equal(silver.current_progress, 20, 'Progress should not exceed target');
    assert.equal(silver.is_completed, 1, 'Should be marked as completed');
    assert.ok(silver.completed_at !== null, 'completed_at should be set');
    
    const firstCompletionTime = silver.completed_at;
    
    // One more increment after completion
    await updateQuestProgress(db, userId, 'correct_answers_count', 5);
    quests = await getDailyQuests(db, userId);
    silver = quests.find(q => q.tier === 'silver');
    
    assert.equal(silver.current_progress, 20);
    assert.equal(silver.completed_at, firstCompletionTime, 'completed_at should not change after first completion');
});

test('dailyQuests - claimQuestReward atomic protection and XP metadata', async () => {
    const db = createMockD1();
    const userId = 1;
    
    await ensureDailyQuests(db, userId);
    
    let mockAddXpCalls = [];
    const mockAddXp = async (db, userId, amount, options) => {
        mockAddXpCalls.push({ userId, amount, options });
    };
    
    // 1. Try to claim before completion
    let result = await claimQuestReward(db, userId, 'bronze', mockAddXp);
    assert.equal(result.success, false, 'Should fail if not completed');
    assert.equal(mockAddXpCalls.length, 0);
    
    // 2. Complete the quest
    await updateQuestProgress(db, userId, 'complete_training_session', 1);
    
    // 3. Claim it
    result = await claimQuestReward(db, userId, 'bronze', mockAddXp);
    assert.equal(result.success, true, 'Should succeed after completion');
    assert.equal(result.rewardXp, 10);
    assert.equal(mockAddXpCalls.length, 1);
    assert.equal(mockAddXpCalls[0].amount, 10);
    assert.equal(mockAddXpCalls[0].options.reason, 'daily_quest_bronze');
    assert.equal(mockAddXpCalls[0].options.sourceType, 'daily_quest');
    assert.equal(mockAddXpCalls[0].options.allowDailyCap, false);
    assert.equal(mockAddXpCalls[0].options.metadata.tier, 'bronze');
    assert.equal(mockAddXpCalls[0].options.metadata.quest_type, 'complete_training_session');
    
    // 4. Try to double claim
    result = await claimQuestReward(db, userId, 'bronze', mockAddXp);
    assert.equal(result.success, false, 'Should fail on double claim');
    assert.equal(mockAddXpCalls.length, 1, 'addXp should not be called again');
});

test('dailyQuests - formatDailyQuestsMessage displays correct status', async () => {
    const db = createMockD1();
    const userId = 1;
    
    await ensureDailyQuests(db, userId);
    
    // Set bronze to claimed
    await updateQuestProgress(db, userId, 'complete_training_session', 1);
    await claimQuestReward(db, userId, 'bronze', async () => {});
    
    // Set silver to completed but not claimed
    await updateQuestProgress(db, userId, 'correct_answers_count', 20);
    
    // Gold is at 0
    const quests = await getDailyQuests(db, userId);
    const message = formatDailyQuestsMessage(quests);
    
    assert.match(message, /🎯 \*مهام اليوم\*/);
    assert.match(message, /🥉 Bronze: أكمل تدريب واحد/);
    assert.match(message, /✅ تم الاستلام \(\+10 XP\)/);
    
    assert.match(message, /🥈 Silver: أجب 20 إجابة صحيحة/);
    assert.match(message, /✅ اكتملت المهمة!/);
    assert.match(message, /🎁 استلام 20 XP/);
    
    assert.match(message, /🥇 Gold: حقق جلسة مثالية/);
    assert.match(message, /▫️ التقدم: 0\/1/);
});

test('daily_tasks old system is untouched', () => {
    const source = fs.readFileSync(new URL('../src/services/dailyTasks.ts', import.meta.url), 'utf8');
    assert.match(source, /export async function incrementDailyTask/);
    assert.match(source, /UPDATE daily_tasks/);
});

test('dailyQuestHooks - recordCorrectTrainingAnswer updates correct_answers_count', async () => {
    const db = createMockD1();
    const userId = 1;

    await recordCorrectTrainingAnswer(db, userId);
    const quests = await getDailyQuests(db, userId);
    const silver = quests.find(q => q.tier === 'silver');

    assert.equal(silver.current_progress, 1);
    assert.equal(silver.is_completed, 0);
});

test('dailyQuestHooks - recordCorrectReviewAnswer updates correct_answers_count and review_answers_count', async () => {
    const db = createMockD1();
    const userId = 1;
    const questDate = getTodayDateBaghdad();

    await ensureDailyQuests(db, userId);
    db._realDb.prepare(
        `UPDATE daily_quests SET quest_type = 'review_answers_count', target_value = 10 WHERE user_id = ? AND quest_date = ? AND tier = 'gold'`
    ).run(userId, questDate);

    await recordCorrectReviewAnswer(db, userId);
    const quests = await getDailyQuests(db, userId);
    const correctQuest = quests.find(q => q.quest_type === 'correct_answers_count');
    const reviewQuest = quests.find(q => q.quest_type === 'review_answers_count');

    assert.equal(correctQuest.current_progress, 1);
    assert.equal(reviewQuest.current_progress, 1);
});

test('dailyQuestHooks - recordTrainingSessionComplete updates complete_training_session', async () => {
    const db = createMockD1();
    const userId = 1;

    await recordTrainingSessionComplete(db, userId, { total: 5, correct: 3, wrong: 2 });
    const quests = await getDailyQuests(db, userId);
    const bronze = quests.find(q => q.tier === 'bronze');

    assert.equal(bronze.current_progress, 1);
    assert.equal(bronze.is_completed, 1);
});

test('dailyQuestHooks - recordTrainingSessionComplete updates perfect_session when no wrong answers', async () => {
    const db = createMockD1();
    const userId = 1;

    await recordTrainingSessionComplete(db, userId, { total: 5, correct: 5, wrong: 0 });
    const quests = await getDailyQuests(db, userId);
    const gold = quests.find(q => q.tier === 'gold');

    assert.equal(gold.current_progress, 1);
    assert.equal(gold.is_completed, 1);
});

test('dailyQuestHooks - recordTrainingSessionComplete skips perfect_session when wrong answers exist', async () => {
    const db = createMockD1();
    const userId = 1;

    await recordTrainingSessionComplete(db, userId, { total: 5, correct: 4, wrong: 1 });
    const quests = await getDailyQuests(db, userId);
    const gold = quests.find(q => q.tier === 'gold');

    assert.equal(gold.current_progress, 0);
    assert.equal(gold.is_completed, 0);
});

test('dailyQuestHooks - no addXp or claimQuestReward inside hooks', () => {
    const source = fs.readFileSync(new URL('../src/services/dailyQuestHooks.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\baddXp\b/);
    assert.doesNotMatch(source, /\bclaimQuestReward\b/);
});

test('dailyQuestHooks - train.ts wires correct training answer and session complete', () => {
    const source = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    assert.match(source, /recordCorrectTrainingAnswer/);
    assert.match(source, /recordTrainingSessionComplete/);
});

test('dailyQuestHooks - learn.ts wires correct review answer', () => {
    const source = fs.readFileSync(new URL('../src/commands/learn.ts', import.meta.url), 'utf8');
    assert.match(source, /recordCorrectReviewAnswer/);
});

test('dailyQuestHooks - real training session completion records complete_training_session', async () => {
    const db = createMockD1();
    const userId = 1;

    await recordTrainingSessionComplete(db, userId, { total: 10, correct: 8, wrong: 2 });
    const quests = await getDailyQuests(db, userId);
    const bronze = quests.find(q => q.tier === 'bronze');

    assert.equal(bronze.current_progress, 1);
    assert.equal(bronze.is_completed, 1);
});

test('dailyQuestHooks - train.ts guards recordTrainingSessionComplete from !session callbacks', () => {
    const source = fs.readFileSync(new URL('../src/commands/train.ts', import.meta.url), 'utf8');
    const noSessionBlock = source.match(/if \(!session\) \{([\s\S]*?\n    \})\s*\n\n    if \(session\.data\.currentIndex/);
    assert.ok(noSessionBlock, 'showTrainingQuestion should early-return on !session before completion branch');
    assert.doesNotMatch(noSessionBlock[1], /recordTrainingSessionComplete/);

    const completionBlock = source.match(/if \(session\.data\.currentIndex >= session\.data\.questions\.length\) \{([\s\S]*?\n    \})\s*\n\n    const q = session/);
    assert.ok(completionBlock, 'showTrainingQuestion should have explicit completion branch');
    assert.match(completionBlock[1], /recordTrainingSessionComplete/);
});
