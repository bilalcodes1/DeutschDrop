import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { createAsyncChallenge, getChallenge, getChallengeQuestions, submitChallengeResult } from '../repositories/challengeRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getChallengeCandidates, getUserByTelegramId } from '../repositories/userRepository';
import { getWordsForUserWithStatus } from '../repositories/wordRepository';
import { unlockAchievement } from '../services/achievements';
import { competitionNotificationsEnabled, displayUserName, sendTelegramMessage } from '../services/notifications';
import { addXp } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';
import { replaceWithText } from './wordPanel';

interface ChallengeSessionData {
    challengeId: number;
    questions: Array<{ word_id: number; prompt: string; answer: string; options: string[]; direction: 'de_ar' | 'ar_de' }>;
    currentIndex: number;
    correctCount: number;
    startTime: number;
}

export function registerChallengeCommand(bot: Bot<BotContext>): void {
    bot.command('challenge', async (ctx) => showChallengeOptions(ctx));

    bot.callbackQuery('menu_challenge', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showChallengeOptions(ctx);
    });

    bot.callbackQuery(/^challenge_create_(5|10|20)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOpponentSelection(ctx, parseInt(ctx.match[1], 10));
    });

    bot.callbackQuery(/^challenge_opp_(5|10|20)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await createChallenge(ctx, parseInt(ctx.match[1], 10), parseInt(ctx.match[2], 10));
    });

    bot.callbackQuery(/^challenge_start_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startExistingChallenge(ctx, parseInt(ctx.match[1], 10));
    });

    bot.callbackQuery(/^challenge_ans_(\d+)_(\d+)_(correct|wrong)$/, async (ctx) => {
        const challengeId = parseInt(ctx.match[1], 10);
        const wordId = parseInt(ctx.match[2], 10);
        const isCorrect = ctx.match[3] === 'correct';
        await handleChallengeAnswer(ctx, challengeId, wordId, isCorrect);
    });
}

async function showChallengeOptions(ctx: BotContext): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const pending = await ctx.db.prepare(
        `SELECT c.challenge_id, c.question_count, u.display_name, u.name
         FROM async_challenges c
         INNER JOIN users u ON u.user_id = c.creator_user_id
         WHERE c.opponent_user_id = ?
           AND c.status = 'opponent_pending'
         ORDER BY c.created_at DESC
         LIMIT 5`
    ).bind(user.user_id).all<{ challenge_id: number; question_count: number; display_name: string | null; name: string }>();

    const keyboard = new InlineKeyboard()
        .text('5 أسئلة', 'challenge_create_5')
        .text('10 أسئلة', 'challenge_create_10')
        .text('20 سؤال', 'challenge_create_20');

    for (const challenge of pending.results ?? []) {
        keyboard.row().text(
            `ابدأ تحدي ${displayUserName(challenge)} (${challenge.question_count})`,
            `challenge_start_${challenge.challenge_id}`
        );
    }

    keyboard.row().text('⬅️ رجوع', 'menu_main');

    await replaceWithText(ctx, '⚔️ *التحديات*\n\nاختر عدد الأسئلة:', keyboard, 'Markdown');
}

async function showOpponentSelection(ctx: BotContext, count: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const candidates = await getChallengeCandidates(ctx.db, user.user_id);
    if (candidates.length === 0) {
        await replaceWithText(ctx, '⚠️ لا يوجد مستخدمون آخرون للتحدي حالياً.', mainMenuKeyboard());
        return;
    }

    const keyboard = new InlineKeyboard();
    for (const candidate of candidates) {
        keyboard.text(candidate.display_name ?? candidate.name, `challenge_opp_${count}_${candidate.user_id}`).row();
    }
    keyboard.text('⬅️ رجوع', 'menu_challenge');
    await replaceWithText(ctx, `⚔️ اختر مستخدم للتحدي (${count} أسئلة):`, keyboard);
}

async function createChallenge(ctx: BotContext, count: number, opponentUserId: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const peer = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ? AND display_name IS NOT NULL')
        .bind(opponentUserId)
        .first<typeof user>();
    if (!peer || peer.user_id === user.user_id) {
        await ctx.reply('⚠️ هذا المستخدم غير متاح للتحدي.');
        return;
    }

    const words = await getWordsForUserWithStatus(ctx.db, user.user_id);
    if (words.length < count) {
        await ctx.reply(`⚠️ تحتاج ${count} كلمات على الأقل لإنشاء التحدي.`, { reply_markup: mainMenuKeyboard() });
        return;
    }

    const questions = shuffle(words).slice(0, count).map((word, index) => {
        const direction: 'de_ar' | 'ar_de' = index % 2 === 0 ? 'de_ar' : 'ar_de';
        const answer = direction === 'de_ar' ? word.arabic : word.german;
        const prompt = direction === 'de_ar' ? word.german : word.arabic;
        const options = shuffle([answer, ...buildDistractors(words, word.word_id, direction, 2)]);
        return { word_id: word.word_id, prompt, answer, options, direction };
    });

    const challengeId = await createAsyncChallenge(ctx.db, user.user_id, peer.user_id, questions);
    await saveBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge', {
        challengeId,
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    }, 120);

    await ctx.reply(`⚔️ بدأ التحدي #${challengeId}. جاوب أسئلتك الآن.`);
    await showChallengeQuestion(ctx, user.user_id);
}

async function startExistingChallenge(ctx: BotContext, challengeId: number): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const challenge = await getChallenge(ctx.db, challengeId);
    if (!challenge || challenge.opponent_user_id !== user.user_id || challenge.status !== 'opponent_pending') {
        await ctx.reply('⚠️ هذا التحدي غير متاح.');
        return;
    }

    const rows = await getChallengeQuestions(ctx.db, challengeId);
    const questions = rows.map(row => ({
        word_id: row.word_id,
        prompt: row.prompt,
        answer: row.answer,
        options: JSON.parse(row.options) as string[],
        direction: row.direction,
    }));

    await saveBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge', {
        challengeId,
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    }, 120);

    await showChallengeQuestion(ctx, user.user_id);
}

async function showChallengeQuestion(ctx: BotContext, userId: number): Promise<void> {
    const session = await getBotSession<ChallengeSessionData>(ctx.db, userId, 'challenge');
    if (!session || session.data.currentIndex >= session.data.questions.length) {
        if (session) await finishChallenge(ctx, userId, session.data);
        return;
    }

    const question = session.data.questions[session.data.currentIndex];
    const progress = `${session.data.currentIndex + 1}/${session.data.questions.length}`;
    const keyboard = new InlineKeyboard();
    for (const option of question.options) {
        keyboard.text(option, `challenge_ans_${session.data.challengeId}_${question.word_id}_${option === question.answer ? 'correct' : 'wrong'}`).row();
    }

    await ctx.reply(`⚔️ (${progress}) ${question.direction === 'de_ar' ? 'اختر المعنى العربي' : 'اختر الكلمة الألمانية'}:\n\n*${question.prompt}*`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
    });
}

async function handleChallengeAnswer(ctx: BotContext, challengeId: number, wordId: number, isCorrect: boolean): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const session = await getBotSession<ChallengeSessionData>(ctx.db, user.user_id, 'challenge');
    const current = session?.data.questions[session.data.currentIndex];
    if (!session || session.data.challengeId !== challengeId || !current || current.word_id !== wordId) {
        await ctx.answerCallbackQuery('هذا ليس السؤال الحالي');
        return;
    }

    if (isCorrect) session.data.correctCount++;
    session.data.currentIndex++;
    await saveBotSession(ctx.db, user.user_id, 'challenge', session.data, 120);
    await ctx.answerCallbackQuery(isCorrect ? '✅ صحيح' : '❌ خطأ');
    await showChallengeQuestion(ctx, user.user_id);
}

async function finishChallenge(ctx: BotContext, userId: number, session: ChallengeSessionData): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'challenge');
    const timeMs = Date.now() - session.startTime;
    const challenge = await submitChallengeResult(ctx.db, session.challengeId, userId, session.correctCount, timeMs);
    if (!challenge) return;

    await addXp(ctx.db, userId, session.correctCount * 2, 'challenge_participation');
    await ctx.reply(`✅ انتهى دورك في التحدي.\nنتيجتك: ${session.correctCount}/${session.questions.length}`);

    if (challenge.status === 'opponent_pending' && challenge.creator_user_id === userId) {
        const creator = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.creator_user_id).first<{ display_name: string | null; name: string }>();
        const opponent = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.opponent_user_id).first<{ user_id: number; telegram_id: number; display_name: string | null; name: string }>();
        if (creator && opponent && await competitionNotificationsEnabled(ctx.db, opponent.user_id)) {
            await sendTelegramMessage(
                ctx.env,
                opponent.telegram_id,
                `⚔️ ${displayUserName(creator)} تحداك! عندك ${challenge.question_count} أسئلة. ابدأ الآن؟`,
                {
                    inline_keyboard: [[
                        { text: '⚔️ ابدأ التحدي', callback_data: `challenge_start_${challenge.challenge_id}` },
                    ]],
                }
            );
        }
        return;
    }

    if (challenge.status === 'completed') {
        await announceChallengeResult(ctx, challenge);
    }
}

async function announceChallengeResult(ctx: BotContext, challenge: NonNullable<Awaited<ReturnType<typeof getChallenge>>>): Promise<void> {
    const creator = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.creator_user_id).first<{ telegram_id: number; display_name: string | null; name: string }>();
    const opponent = await ctx.db.prepare('SELECT * FROM users WHERE user_id = ?').bind(challenge.opponent_user_id).first<{ telegram_id: number; display_name: string | null; name: string }>();
    if (!creator || !opponent) return;

    let result = `⚔️ نتيجة التحدي #${challenge.challenge_id}\n\n` +
        `${displayUserName(creator)}: ${challenge.creator_score}/${challenge.question_count}\n` +
        `${displayUserName(opponent)}: ${challenge.opponent_score}/${challenge.question_count}\n\n`;

    if (challenge.winner_user_id) {
        const winner = challenge.winner_user_id === challenge.creator_user_id ? creator : opponent;
        result += `🏆 الفائز: ${displayUserName(winner)} +100 XP`;
        await addXp(ctx.db, challenge.winner_user_id, 100, 'challenge_win');
        await unlockAchievement(ctx, challenge.winner_user_id, 'first_challenge_win');
    } else {
        result += '🤝 تعادل!';
    }

    await sendTelegramMessage(ctx.env, creator.telegram_id, result);
    await sendTelegramMessage(ctx.env, opponent.telegram_id, result);
}

async function getCurrentUser(ctx: BotContext) {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return null;
    }
    return user;
}

function buildDistractors(words: Array<{ word_id: number; german: string; arabic: string }>, currentWordId: number, direction: 'de_ar' | 'ar_de', count: number): string[] {
    return shuffle(words.filter(word => word.word_id !== currentWordId))
        .map(word => direction === 'de_ar' ? word.arabic : word.german)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, count);
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
