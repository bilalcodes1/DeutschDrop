import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../models';

export type SmartNotificationType =
    'no_words' | 'quick_recall' | 'arabic_to_german' | 'missing_letters' | 'first_last_hint' | 'due_word' | 'hard_word' | 'context_example' | 'pictogram_recall' | 'review_plan' | 'motivational' | 'daily_summary';

export interface SmartWord {
    word_id: number;
    german: string;
    arabic: string;
    example: string | null;
    pronunciation_ar: string | null;
    pronunciation_latin: string | null;
    image_url?: string | null;
}

export interface SmartNotification {
    type: SmartNotificationType;
    word: SmartWord | null;
    text: string;
    photoUrl?: string;
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

interface NotificationSettingsRow {
    reminders_enabled: number;
    notification_mode: 'light' | 'normal' | 'intensive' | 'custom' | 'off' | null;
    notification_intensity: 'light' | 'normal' | 'intensive' | 'custom' | 'off' | null;
    notification_interval_hours: number | null;
    review_plan: 'none' | 'all_words_day' | 'all_words_week' | null;
    notification_batch_size: number | null;
    morning_time: string | null;
    afternoon_time: string | null;
    evening_time: string | null;
    notification_timezone: string | null;
    last_notification_at: string | null;
}

interface UserForNotification {
    user_id: number;
    telegram_id: number;
    updated_at: string | null;
}

export async function shouldSendNotification(db: D1Database, user: UserForNotification): Promise<boolean> {
    const settings = await getNotificationSettings(db, user.user_id);
    const mode = settings?.notification_mode ?? settings?.notification_intensity ?? 'normal';
    if (!settings || settings.reminders_enabled === 0 || mode === 'off') return false;
    const intervalHours = mode === 'custom' ? settings.notification_interval_hours ?? 2 : 6;
    if (settings.last_notification_at && withinHours(settings.last_notification_at, intervalHours)) return false;
    if (user.updated_at && withinMinutes(user.updated_at, 30)) return false;

    const sentToday = await countNotificationsToday(db, user.user_id);
    if (sentToday >= maxPerDay(mode)) return false;

    return isWithinNotificationWindow(settings);
}

export async function selectNotificationForUser(db: D1Database, userId: number): Promise<SmartNotification> {
    const totalWords = await countWords(db, userId);
    if (totalWords === 0) {
        return buildNoWordsNotification();
    }

    const activePlan = await getActiveReviewPlanForNotification(db, userId);
    if (activePlan) return buildReviewPlanNotification(activePlan);

    const selected = await selectNotificationWord(db, userId, 'normal');
    if (selected?.reason === 'hard' || selected?.reason === 'recent_wrong') return buildHardWordNotification(selected.word);
    const dueCount = await countDueWords(db, userId);
    if (selected?.reason === 'due') return buildDueWordNotification(selected.word, Math.max(1, dueCount), userId);

    const randomWord = selected?.word ?? await selectAnyWord(db, userId);
    if (randomWord) {
        const variants = [
            () => buildQuickRecallNotification(randomWord),
            () => buildArabicToGermanNotification(randomWord),
            () => buildMissingLettersNotification(randomWord),
            () => buildFirstLastHintNotification(randomWord),
        ];
        const withExample = await selectExampleWord(db, userId);
        if (withExample) variants.push(() => buildContextExampleNotification(withExample));
        const withPictogram = await selectPictogramWord(db, userId);
        if (withPictogram) variants.push(() => buildPictogramRecallNotification(withPictogram));
        return variants[Math.abs(userId + totalWords) % variants.length]();
    }

    return buildMotivationalNotification(userId + totalWords);
}

export async function selectNotificationWord(
    db: D1Database,
    userId: number,
    notificationType: 'light' | 'normal' | 'intensive' | 'custom'
): Promise<{ word: SmartWord; reason: 'hard' | 'recent_wrong' | 'due' | 'new' | 'normal' } | null> {
    const hard = await selectHardWord(db, userId);
    if (hard) return { word: hard, reason: 'hard' };
    const recent = await selectRecentWrongWord(db, userId);
    if (recent) return { word: recent, reason: 'recent_wrong' };
    const due = await selectDueWord(db, userId);
    if (due) return { word: due, reason: 'due' };
    const fresh = await selectNewLowSeenWord(db, userId);
    if (fresh) return { word: fresh, reason: 'new' };
    const normal = await selectAnyWord(db, userId);
    return normal ? { word: normal, reason: notificationType === 'intensive' ? 'due' : 'normal' } : null;
}

export async function sendSmartNotification(env: Env, user: UserForNotification): Promise<boolean> {
    if (!await shouldSendNotification(env.DB, user)) return false;

    try {
        const notification = await selectNotificationForUser(env.DB, user.user_id);
        const eventId = await createNotificationEvent(env.DB, user.user_id, notification.type, notification.word?.word_id ?? null);
        const replyMarkup = withEventCallbacks(notification.replyMarkup, eventId, Boolean(notification.word));

        if (notification.photoUrl) {
            await telegramCall(env, 'sendPhoto', {
                chat_id: user.telegram_id,
                photo: notification.photoUrl,
                caption: notification.text,
                reply_markup: replyMarkup,
            });
        } else {
            await telegramCall(env, 'sendMessage', {
                chat_id: user.telegram_id,
                text: notification.text,
                reply_markup: replyMarkup,
            });
        }

        await env.DB.prepare('UPDATE settings SET last_notification_at = datetime("now"), last_notified_word_id = ? WHERE user_id = ?').bind(notification.word?.word_id ?? null, user.user_id).run();
        return true;
    } catch {
        return false;
    }
}

export async function getNotificationEventWord(db: D1Database, eventId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin
         FROM notification_events ne
         INNER JOIN words w ON w.word_id = ne.word_id
         WHERE ne.id = ?`
    ).bind(eventId).first<SmartWord>();
}

export async function recordNotificationResponse(db: D1Database, eventId: number, response: 'known' | 'forgotten' | 'shown'): Promise<void> {
    await db.prepare(
        'UPDATE notification_events SET response = ?, responded_at = datetime("now") WHERE id = ?'
    ).bind(response, eventId).run();
}

export async function markForgottenForTrainingPriority(db: D1Database, eventId: number): Promise<void> {
    const event = await db.prepare('SELECT user_id, word_id FROM notification_events WHERE id = ?').bind(eventId).first<{ user_id: number; word_id: number | null }>();
    if (!event?.word_id) return;

    await db.prepare(
        `UPDATE user_words
         SET wrong_count = wrong_count + 1, next_review = datetime('now')
         WHERE user_id = ? AND word_id = ?`
    ).bind(event.user_id, event.word_id).run();
}

export async function buildDailySummaryNotification(db: D1Database, userId: number): Promise<string> {
    const reviews = await db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE user_id = ? AND date(reviewed_at) = date("now")').bind(userId).first<{ count: number }>();
    const xp = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log WHERE user_id = ? AND date(created_at) = date("now")').bind(userId).first<{ total: number }>();
    const accuracy = await db.prepare(
        `SELECT
            COALESCE(ROUND(100.0 * SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)), 0) AS percent
         FROM reviews WHERE user_id = ? AND date(reviewed_at) = date("now")`
    ).bind(userId).first<{ percent: number }>();
    const streak = await db.prepare('SELECT current_streak FROM daily_streaks WHERE user_id = ?').bind(userId).first<{ current_streak: number }>();
    const hard = await selectHardWord(db, userId);

    return `📊 ملخصك اليوم\n\n` +
        `تعلمت: 0\n` +
        `راجعت: ${reviews?.count ?? 0}\n` +
        `الدقة: ${accuracy?.percent ?? 0}%\n` +
        `XP اليوم: +${xp?.total ?? 0}\n` +
        `السلسلة: ${streak?.current_streak ?? 0} أيام\n\n` +
        `كلمة تحتاج تثبيت:\n` +
        `🇩🇪 ${hard?.german ?? '-'} = ${hard?.arabic ?? '-'}`;
}

async function getNotificationSettings(db: D1Database, userId: number): Promise<NotificationSettingsRow | null> {
    return db.prepare(
        `SELECT reminders_enabled, notification_mode, notification_intensity, notification_interval_hours, review_plan, notification_batch_size,
                morning_time, afternoon_time, evening_time, notification_timezone, last_notification_at
         FROM settings WHERE user_id = ?`
    ).bind(userId).first<NotificationSettingsRow>();
}

async function countNotificationsToday(db: D1Database, userId: number): Promise<number> {
    const row = await db.prepare(
        'SELECT COUNT(*) AS count FROM notification_events WHERE user_id = ? AND date(sent_at) = date("now")'
    ).bind(userId).first<{ count: number }>();
    return row?.count ?? 0;
}

function maxPerDay(intensity: string): number {
    if (intensity === 'light') return 1;
    if (intensity === 'intensive') return 3;
    if (intensity === 'custom') return 24;
    return 2;
}

function isWithinNotificationWindow(settings: NotificationSettingsRow): boolean {
    if ((settings.notification_mode ?? settings.notification_intensity) === 'custom') return true;
    const hour = getHour(settings.notification_timezone ?? 'Asia/Baghdad');
    const intensity = settings.notification_mode ?? settings.notification_intensity ?? 'normal';
    const windows = [parseHour(settings.morning_time ?? '09:00')];
    if (intensity === 'normal' || intensity === 'intensive') windows.push(parseHour(settings.evening_time ?? '20:00'));
    if (intensity === 'intensive') windows.push(parseHour(settings.afternoon_time ?? '15:00'));
    return windows.includes(hour);
}

async function getActiveReviewPlanForNotification(db: D1Database, userId: number): Promise<{ id: number; total_words: number; reviewed_words: number; batch_size: number } | null> {
    return db.prepare(
        `SELECT id, total_words, reviewed_words, batch_size
         FROM daily_review_plans
         WHERE user_id = ? AND is_active = 1 AND ends_at > datetime('now') AND reviewed_words < total_words
         ORDER BY started_at DESC
         LIMIT 1`
    ).bind(userId).first();
}

function parseHour(time: string): number {
    const hour = Number(time.split(':')[0]);
    return Number.isFinite(hour) ? hour : 9;
}

function getHour(timeZone: string): number {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).format(new Date()));
}

function withinHours(value: string, hours: number): boolean {
    return Date.now() - new Date(value).getTime() < hours * 60 * 60 * 1000;
}

function withinMinutes(value: string, minutes: number): boolean {
    return Date.now() - new Date(value).getTime() < minutes * 60 * 1000;
}

async function countWords(db: D1Database, userId: number): Promise<number> {
    return (await db.prepare('SELECT COUNT(*) AS count FROM words WHERE added_by = ?').bind(userId).first<{ count: number }>())?.count ?? 0;
}

async function countDueWords(db: D1Database, userId: number): Promise<number> {
    return (await db.prepare('SELECT COUNT(*) AS count FROM user_words WHERE user_id = ? AND (status = "new" OR next_review <= datetime("now"))').bind(userId).first<{ count: number }>())?.count ?? 0;
}

async function selectDueWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin
         FROM words w
         INNER JOIN user_words uw ON uw.word_id = w.word_id
         WHERE uw.user_id = ?
           AND (uw.status = 'new' OR uw.next_review <= datetime('now'))
           AND NOT EXISTS (
                SELECT 1 FROM notification_events ne
                WHERE ne.user_id = ?
                  AND ne.word_id = w.word_id
                  AND ne.sent_at >= datetime('now', '-24 hours')
           )
         ORDER BY uw.next_review ASC, RANDOM()
         LIMIT 1`
    ).bind(userId, userId).first<SmartWord>();
}

async function selectHardWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin
         FROM words w
         INNER JOIN user_words uw ON uw.word_id = w.word_id
         LEFT JOIN word_learning_stats wls ON wls.user_id = uw.user_id AND wls.word_id = uw.word_id
         WHERE uw.user_id = ?
           AND (COALESCE(wls.is_hard, 0) = 1 OR COALESCE(wls.difficulty_score, 0) >= 0.7 OR uw.wrong_count >= 2 OR uw.wrong_count > uw.correct_count OR uw.status = 'learning')
           AND NOT EXISTS (
                SELECT 1 FROM notification_events ne
                WHERE ne.user_id = ?
                  AND ne.word_id = w.word_id
                  AND ne.sent_at >= datetime('now', '-24 hours')
           )
         ORDER BY COALESCE(wls.difficulty_score, 0) DESC, uw.wrong_count DESC, RANDOM()
         LIMIT 1`
    ).bind(userId, userId).first<SmartWord>();
}

async function selectRecentWrongWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin
         FROM word_learning_stats wls
         INNER JOIN words w ON w.word_id = wls.word_id
         WHERE wls.user_id = ?
           AND wls.last_wrong_at IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM notification_events ne
                WHERE ne.user_id = ?
                  AND ne.word_id = w.word_id
                  AND ne.sent_at >= datetime('now', '-24 hours')
           )
         ORDER BY datetime(wls.last_wrong_at) DESC, wls.difficulty_score DESC
         LIMIT 1`
    ).bind(userId, userId).first<SmartWord>();
}

async function selectNewLowSeenWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin
         FROM words w
         LEFT JOIN word_learning_stats wls ON wls.user_id = w.added_by AND wls.word_id = w.word_id
         WHERE w.added_by = ?
           AND COALESCE(wls.seen_count, 0) <= 1
         ORDER BY w.created_at DESC, RANDOM()
         LIMIT 1`
    ).bind(userId).first<SmartWord>();
}

async function selectExampleWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT word_id, german, arabic, example, pronunciation_ar, pronunciation_latin FROM words
         WHERE added_by = ? AND example IS NOT NULL AND TRIM(example) != ''
         ORDER BY RANDOM() LIMIT 1`
    ).bind(userId).first<SmartWord>();
}

async function selectPictogramWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare(
        `SELECT w.word_id, w.german, w.arabic, w.example, w.pronunciation_ar, w.pronunciation_latin, wp.image_url
         FROM words w
         INNER JOIN word_pictograms wp ON wp.word_id = w.word_id
         WHERE w.added_by = ?
         ORDER BY RANDOM() LIMIT 1`
    ).bind(userId).first<SmartWord>();
}

async function selectAnyWord(db: D1Database, userId: number): Promise<SmartWord | null> {
    return db.prepare('SELECT word_id, german, arabic, example, pronunciation_ar, pronunciation_latin FROM words WHERE added_by = ? ORDER BY RANDOM() LIMIT 1').bind(userId).first<SmartWord>();
}

async function createNotificationEvent(db: D1Database, userId: number, type: SmartNotificationType, wordId: number | null): Promise<number> {
    const result = await db.prepare(
        'INSERT INTO notification_events (user_id, type, word_id, prompt_type, selected_reason, question_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, type, wordId, type, inferSelectedReason(type), inferQuestionType(type)).run();
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

function inferSelectedReason(type: SmartNotificationType): string {
    if (type === 'hard_word') return 'hard';
    if (type === 'due_word') return 'due';
    if (type === 'quick_recall') return 'new';
    return 'normal';
}

function inferQuestionType(type: SmartNotificationType): string {
    if (type === 'arabic_to_german') return 'reverse';
    if (type === 'missing_letters') return 'missing_letters';
    if (type === 'first_last_hint') return 'first_last';
    if (type === 'context_example') return 'example';
    if (type === 'pictogram_recall') return 'pictogram';
    return 'meaning';
}

function withEventCallbacks(markup: SmartNotification['replyMarkup'], eventId: number, hasWord: boolean): SmartNotification['replyMarkup'] {
    if (!hasWord) return markup;
    return {
        inline_keyboard: markup.inline_keyboard.map(row => row.map(button => ({
            ...button,
            callback_data: button.callback_data
                .replace('{eventId}', String(eventId)),
        }))),
    };
}

function recallButtons(): SmartNotification['replyMarkup'] {
    return {
        inline_keyboard: [
            [{ text: '👁 أظهر الجواب', callback_data: 'notif_show_{eventId}' }],
            [{ text: '📚 راجع الآن', callback_data: 'menu_learn' }, { text: '🏋️ تدريب قصير', callback_data: 'train_quick' }],
            [{ text: '🔕 إيقاف الإشعارات', callback_data: 'notif_disable' }],
        ],
    };
}

function trainingButtons(): SmartNotification['replyMarkup'] {
    return {
        inline_keyboard: [
            [{ text: '👁 أظهر الجواب', callback_data: 'notif_show_{eventId}' }],
            [{ text: '📚 راجع الآن', callback_data: 'menu_learn' }, { text: '🏋️ تدريب قصير', callback_data: 'train_quick' }],
            [{ text: '🔕 إيقاف الإشعارات', callback_data: 'notif_disable' }],
        ],
    };
}

function buildNoWordsNotification(): SmartNotification {
    return {
        type: 'no_words',
        word: null,
        text: '👋 ابدأ رحلتك مع DeutschDrop\nأضف كلمة بهذه الصيغة:\nHaus = بيت\nأو ارفع CSV من إدارة الكلمات.',
        replyMarkup: { inline_keyboard: [[{ text: '📂 كلماتي', callback_data: 'menu_words' }], [{ text: '🔕 إيقاف الإشعارات', callback_data: 'notif_disable' }]] },
    };
}

function buildQuickRecallNotification(word: SmartWord): SmartNotification {
    return {
        type: 'quick_recall',
        word,
        text: `🧠 اختبار 10 ثواني\n\nشنو معنى:\n🇩🇪 ${word.german}\n\nحاول تتذكر قبل لا تفتح البوت.`,
        replyMarkup: recallButtons(),
    };
}

function buildArabicToGermanNotification(word: SmartWord): SmartNotification {
    return {
        type: 'arabic_to_german',
        word,
        text: `✍️ اكتبها بالألماني\n\n🇮🇶 ${word.arabic}\n\nتتذكر شنو تصير؟`,
        replyMarkup: recallButtons(),
    };
}

function buildMissingLettersNotification(word: SmartWord): SmartNotification {
    return {
        type: 'missing_letters',
        word,
        text: `🧩 أكمل الكلمة\n\nالمعنى: ${word.arabic}\n${maskGerman(word.german)}`,
        replyMarkup: recallButtons(),
    };
}

function buildFirstLastHintNotification(word: SmartWord): SmartNotification {
    return {
        type: 'first_last_hint',
        word,
        text: `✍️ تلميح كتابة\n\nالمعنى: ${word.arabic}\nأول حرف: ${word.german[0] ?? '-'}\nآخر حرف: ${word.german[word.german.length - 1] ?? '-'}`,
        replyMarkup: recallButtons(),
    };
}

function buildDueWordNotification(word: SmartWord, dueCount: number, seed: number): SmartNotification {
    const templates = [
        `📚 مراجعة ذكية\n\nعندك ${dueCount} كلمة مستحقة.\nنبدأ بوحدة بس:\n\n🇩🇪 ${word.german}\n\nتتذكر معناها؟`,
        `🧠 قبل لا تنساها\n\nهاي كلمة مستحقة اليوم:\n🇩🇪 ${word.german}`,
        `⚡ اختبار 10 ثواني\n\nشنو معنى:\n🇩🇪 ${word.german}`,
    ];
    return { type: 'due_word', word, text: templates[Math.abs(seed) % templates.length], replyMarkup: trainingButtons() };
}

function buildReviewPlanNotification(plan: { id: number; total_words: number; reviewed_words: number; batch_size: number }): SmartNotification {
    const remaining = Math.max(0, plan.total_words - plan.reviewed_words);
    return {
        type: 'review_plan',
        word: null,
        text: `📚 جلسة مراجعة ${plan.reviewed_words}/${plan.total_words}\n\nباقي ${remaining} كلمة من الخطة.\nابدأ جلسة ${Math.min(plan.batch_size, remaining)} كلمات الآن.`,
        replyMarkup: {
            inline_keyboard: [
                [{ text: '▶️ ابدأ الجلسة', callback_data: `train_plan_${plan.id}` }],
                [{ text: '🔁 تأجيل', callback_data: 'review_plan_delay' }, { text: '❌ إلغاء الخطة', callback_data: 'review_plan_cancel' }],
            ],
        },
    };
}

function buildHardWordNotification(word: SmartWord): SmartNotification {
    return {
        type: 'hard_word',
        word,
        text: `🔥 كلمة صعبة تحتاج تثبيت\n\nهاي الكلمة غلطت بيها أكثر من مرة:\n🇩🇪 ${word.german}\n\nخلينا نثبتها اليوم.`,
        replyMarkup: trainingButtons(),
    };
}

function buildContextExampleNotification(word: SmartWord): SmartNotification {
    return {
        type: 'context_example',
        word,
        text: `🧩 افهمها من الجملة\n\n${word.example}\n\nشنو معنى "${word.german}" هنا؟`,
        replyMarkup: recallButtons(),
    };
}

function buildPictogramRecallNotification(word: SmartWord): SmartNotification {
    return {
        type: 'pictogram_recall',
        word,
        photoUrl: word.image_url ?? undefined,
        text: '🖼 تذكّر بالصورة\n\nشنو الكلمة الألمانية لهذه الصورة؟',
        replyMarkup: recallButtons(),
    };
}

function buildMotivationalNotification(seed: number): SmartNotification {
    const messages = [
        'دقيقة مراجعة اليوم أفضل من ساعة نسيان بكرة.',
        'كلمة واحدة الآن تقرّبك من الألمانية أكثر.',
        'راجع 5 كلمات فقط وخلّي السلسلة مستمرة.',
        'لا تخلي الكلمات الصعبة تهرب منك.',
        '🌟 ممتاز، لا توجد كلمات مستحقة الآن.\nجرّب تدريب سريع حتى تثبت حفظك: /train',
    ];
    return {
        type: 'motivational',
        word: null,
        text: messages[Math.abs(seed) % messages.length],
        replyMarkup: { inline_keyboard: [[{ text: '📚 راجع الآن', callback_data: 'menu_learn' }, { text: '🏋️ تدريب قصير', callback_data: 'train_quick' }], [{ text: '🔕 إيقاف الإشعارات', callback_data: 'notif_disable' }]] },
    };
}

function maskGerman(value: string): string {
    return value.split('').map((char, index) => {
        if (char === ' ') return ' ';
        if (index === 0 || index === value.length - 1) return char;
        return '_';
    }).join(' ');
}

async function telegramCall(env: Env, method: string, body: unknown): Promise<void> {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}
