import { queryAll, queryOne, run } from '../db/queries';
import { addXp } from './xpLevels';
import type { D1Database } from '@cloudflare/workers-types';

export interface DailyQuest {
    quest_id: number;
    user_id: number;
    quest_date: string;
    tier: 'bronze' | 'silver' | 'gold';
    quest_type: string;
    target_value: number;
    current_progress: number;
    reward_xp: number;
    is_completed: number;
    is_claimed: number;
    completed_at: string | null;
    claimed_at: string | null;
}

const DEFAULT_QUESTS = [
    { tier: 'bronze', quest_type: 'complete_training_session', target_value: 1, reward_xp: 10 },
    { tier: 'silver', quest_type: 'correct_answers_count', target_value: 20, reward_xp: 20 },
    { tier: 'gold', quest_type: 'perfect_session', target_value: 1, reward_xp: 30 }
] as const;

export function getTodayDateBaghdad(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
}

export async function ensureDailyQuests(db: D1Database, userId: number, date?: string): Promise<void> {
    const questDate = date ?? getTodayDateBaghdad();
    
    for (const q of DEFAULT_QUESTS) {
        await run(
            db,
            `INSERT OR IGNORE INTO daily_quests (user_id, quest_date, tier, quest_type, target_value, reward_xp)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, questDate, q.tier, q.quest_type, q.target_value, q.reward_xp]
        );
    }
}

export async function getDailyQuests(db: D1Database, userId: number, date?: string): Promise<DailyQuest[]> {
    const questDate = date ?? getTodayDateBaghdad();
    await ensureDailyQuests(db, userId, questDate);
    
    return queryAll<DailyQuest>(
        db,
        `SELECT * FROM daily_quests WHERE user_id = ? AND quest_date = ? ORDER BY 
         CASE tier WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2 WHEN 'gold' THEN 3 END`,
        [userId, questDate]
    );
}

export async function updateQuestProgress(db: D1Database, userId: number, eventType: string, increment: number, metadata?: any): Promise<void> {
    const date = getTodayDateBaghdad();
    await ensureDailyQuests(db, userId, date);
    
    await run(
        db,
        `UPDATE daily_quests
         SET 
            completed_at = CASE WHEN is_completed = 0 AND current_progress + ? >= target_value THEN datetime('now') ELSE completed_at END,
            is_completed = CASE WHEN current_progress + ? >= target_value THEN 1 ELSE is_completed END,
            current_progress = MIN(target_value, current_progress + ?)
         WHERE user_id = ? AND quest_date = ? AND quest_type = ?`,
        [increment, increment, increment, userId, date, eventType]
    );
}

export async function claimQuestReward(db: D1Database, userId: number, tier: 'bronze' | 'silver' | 'gold', addXpFn: typeof addXp = addXp): Promise<{ success: boolean; rewardXp: number; message: string }> {
    const date = getTodayDateBaghdad();
    
    // Attempt to claim atomically using RETURNING
    const stmt = db.prepare(`
        UPDATE daily_quests 
        SET is_claimed = 1, claimed_at = datetime('now') 
        WHERE user_id = ? AND quest_date = ? AND tier = ? AND is_completed = 1 AND is_claimed = 0
        RETURNING quest_id, quest_type, reward_xp
    `).bind(userId, date, tier);
    
    const result = await stmt.first<{ quest_id: number, quest_type: string, reward_xp: number }>();
    
    if (!result) {
        return { success: false, rewardXp: 0, message: 'Quest not completable or already claimed.' };
    }
    
    // Reward XP
    await addXpFn(db, userId, result.reward_xp, {
        reason: "daily_quest_" + tier,
        sourceType: 'daily_quest',
        sourceId: result.quest_id.toString(),
        allowDailyCap: false,
        metadata: {
            tier,
            quest_type: result.quest_type,
            reward_xp: result.reward_xp
        }
    });
    
    return { success: true, rewardXp: result.reward_xp, message: 'Reward claimed successfully!' };
}

export function formatDailyQuestsMessage(quests: DailyQuest[]): string {
    const lines = ['🎯 *مهام اليوم*'];
    
    for (const q of quests) {
        let label = q.quest_type; // Fallback
        
        if (q.quest_type === 'complete_training_session') label = 'أكمل تدريب واحد';
        else if (q.quest_type === 'correct_answers_count') label = "أجب " + q.target_value + " إجابة صحيحة";
        else if (q.quest_type === 'perfect_session') label = 'حقق جلسة مثالية';

        const tierEmoji = q.tier === 'bronze' ? '🥉' : q.tier === 'silver' ? '🥈' : '🥇';
        const tierName = q.tier.charAt(0).toUpperCase() + q.tier.slice(1);
        
        lines.push("\n" + tierEmoji + " " + tierName + ": " + label);
        lines.push("التقدم: " + q.current_progress + "/" + q.target_value);
        lines.push("المكافأة: +" + q.reward_xp + " XP");
        
        if (q.is_claimed) {
            lines.push("✅ تم الاستلام");
        } else if (q.is_completed) {
            lines.push("🎁 جاهزة للاستلام");
        } else {
            lines.push("▫️ قيد التقدم");
        }
    }
    
    return lines.join("\n");
}
