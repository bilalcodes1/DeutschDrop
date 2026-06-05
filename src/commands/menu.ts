import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getActiveAnnouncement } from '../repositories/announcementRepository';
import { getActiveSupportStatus } from '../repositories/supportRepository';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { deleteBotSession } from '../repositories/sessionRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { formatSupportRemaining, getUserRoleBadge } from '../services/roleUi';
import { PROJECT_CODE_LINES_LABEL } from '../generated/projectStats';
import { replaceWithText } from './wordPanel';

export function registerMenuCommand(bot: Bot<BotContext>): void {
    bot.command('menu', async (ctx) => {
        await showMainMenu(ctx);
    });

    // Handle menu callbacks that are not owned by feature modules.
    bot.callbackQuery('menu_train', async (ctx) => {
        await clearTextInteractionSessions(ctx);
        await replaceWithText(
            ctx,
            trainMenuText(),
            trainCountKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_words', async (ctx) => {
        await clearTrainingAndEditSessions(ctx);
        await replaceWithText(
            ctx,
            '📂 *كلماتي*\n\nاختر إحدى الخيارات:',
            wordsMenuKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_more', async (ctx) => {
        await clearTrainingAndEditSessions(ctx);
        await replaceWithText(ctx, '⚙️ *المزيد*\n\nكل الأدوات المتقدمة هنا:', moreMenuKeyboard(isAdminTelegramId(ctx.env, ctx.from?.id)), 'Markdown');
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_about', async (ctx) => {
        await ctx.answerCallbackQuery();
        await replaceWithText(ctx, aboutProjectText(), aboutProjectKeyboard());
    });

    bot.callbackQuery('menu_help', async (ctx) => {
        await ctx.answerCallbackQuery();
        await replaceWithText(ctx, helpText(), helpKeyboard());
    });

    // Back to main menu
    bot.callbackQuery('menu_main', async (ctx) => {
        await ctx.answerCallbackQuery();
        await clearTrainingAndEditSessions(ctx);
        await showMainMenu(ctx);
    });
}

export async function showMainMenu(ctx: BotContext): Promise<void> {
    const isAdmin = isAdminTelegramId(ctx.env, ctx.from?.id);
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (user?.display_name) {
        const settings = await getUserSettings(ctx.db, user.user_id);
        if (!settings?.german_level) {
            await showLevelSelection(ctx, 'حدد مستواك حتى أضبط لك المصادر والإشعارات:');
            return;
        }
    }
    await replaceWithText(ctx, await mainMenuText(ctx), mainMenuKeyboard(isAdmin), 'Markdown');
}

export function mainMenuKeyboard(isAdmin: boolean = false): InlineKeyboard {
    void isAdmin;
    return new InlineKeyboard()
        .text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('📂 كلماتي', 'menu_words')
        .text('⚙️ المزيد', 'menu_more');
}

async function mainMenuText(ctx: BotContext): Promise<string> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const announcement = await getActiveAnnouncement(ctx.db);
    const announcementText = announcement ? `📌 *إعلان:*\n${announcement.message}\n\n` : '';

    if (!user) return `${announcementText}🏠 *القائمة الرئيسية*`;

    const supportStatus = await getActiveSupportStatus(ctx.db, user.user_id);
    const badge = getUserRoleBadge(user, ctx.env, supportStatus);
    const supportLine = badge === '💙 داعم' && supportStatus?.supporter_until
        ? `\nينتهي الدعم خلال: *${formatSupportRemaining(supportStatus.supporter_until)}*`
        : '';

    const settings = await getUserSettings(ctx.db, user.user_id);
    const germanLevel = settings?.german_level ?? 'A1';

    return `${announcementText}` +
        `🏠 *DeutschDrop*\n\n` +
        `أهلاً *${user.display_name ?? user.name}*\n` +
        `المستوى: *${germanLevel}*\n` +
        `الحالة: *${badge}*${supportLine}\n\n` +
        `ماذا تريد الآن؟`;
}

function trainCountKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('⚡ تدريب سريع', 'train_quick')
        .text('🎲 مختلط', 'train_mixed').row()
        .text('✍️ كتابة', 'train_typing')
        .text('🧩 حروف ناقصة', 'train_missing').row()
        .text('🇩🇪 ألماني → عربي', 'train_de_ar').row()
        .text('🇮🇶 عربي → ألماني', 'train_ar_de').row()
        .text('🔥 الكلمات الصعبة', 'train_hard').row()
        .text('📦 جلسة خطة المراجعة', 'train_plan').row()
        .text('⬅️ رجوع', 'menu_main')
        .text('🏠 الرئيسية', 'menu_main');
}

function wordsMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📋 عرض كل الكلمات', 'list_words')
        .text('➕ إضافة كلمة', 'add_word').row()
        .text('📤 رفع CSV', 'upload_csv')
        .text('🔍 بحث', 'word_search_start').row()
        .text('☑️ تحديد وحذف', 'select_words_0')
        .text('📌 الكلمات الصعبة', 'hard_words').row()
        .text('👥 كلمات المستخدمين', 'shared_users:page:1').row()
        .text('🗂 مجموعات الكلمات', 'collections:menu').row()
        .text('📥 العروض المشتركة', 'shared_offers:page:1').row()
        .text('💡 اقتراحات', 'suggest_peer_words').row()
        .text('⬅️ رجوع', 'menu_main')
        .text('🏠 الرئيسية', 'menu_main');
}

export function moreMenuKeyboard(isAdmin: boolean = false): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('👤 ملفي', 'menu_profile')
        .text('🏆 الصدارة', 'menu_leaderboard').row()
        .text('⚔️ التحديات', 'menu_challenge')
        .text('🔔 الإشعارات', 'menu_notifications').row()
        .text('📊 الإحصائيات', 'menu_stats')
        .text('📚 المصادر', 'menu_sources').row()
        .text('🗂 مجموعات الكلمات', 'collections:menu').row()
        .text('❓ طريقة الاستخدام', 'menu_help').row()
        .text('💙 دعم المشروع', 'menu_support')
        .text('ℹ️ عن المشروع', 'menu_about').row();

    if (isAdmin) keyboard.text('🛠 لوحة الأدمن', 'admin_panel').row();

    return keyboard.text('🏠 الرئيسية', 'menu_main');
}

function aboutProjectText(): string {
    return `ℹ️ عن DeutschDrop

DeutschDrop هو بوت تعليمي لتعلم وحفظ الكلمات الألمانية بطريقة عملية داخل تيليگرام.

فكرة المشروع جاءت حتى نبتعد عن التشتت بين تطبيقات كثيرة:
تطبيق للحفظ، تطبيق للنطق، تطبيق للتدريب، تطبيق للمراجعة، وبعضها مجاني وبعضها مدفوع.

هنا حاولنا نجمع كل الطرق المفيدة في مكان واحد نستخدمه يومياً:
تيليگرام.

الهدف من DeutschDrop:

* حفظ الكلمات الألمانية.
* مراجعتها بتكرار ذكي.
* تثبيت النطق الصحيح.
* التدريب على الكتابة.
* ممارسة الترجمة من الألماني للعربي والعكس.
* التركيز على الكلمات التي تخطئ بها أكثر.
* جعل التعلم بسيط ومجاني قدر الإمكان.

المشروع صُمم حتى يكون مساعد يومي للمتعلم، مو مجرد قائمة كلمات.

🧾 حجم المشروع:
يتكوّن DeutschDrop حالياً من حوالي ${PROJECT_CODE_LINES_LABEL} سطر برمجي.

👨‍💻 المطور

بلال زامل
طالب في جامعة الأنبار
قسم علوم الحاسوب

Instagram:
@bilalcodes1

Telegram:
@bilalcodes1`;
}

function aboutProjectKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .url('📸 Instagram', 'https://instagram.com/bilalcodes1')
        .url('✈️ Telegram', 'https://t.me/bilalcodes1').row()
        .text('💙 دعم المشروع', 'menu_support').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

function onboardingText(): string {
    return `👋 أهلاً بك في DeutschDrop

حتى تبدأ بسرعة:

1. أضف أول 5 كلمات.
2. جرّب 📚 راجع الآن.
3. جرّب 🏋️ تدريب مختلط.
4. فعّل 🔔 الإشعارات حتى لا تنسى الكلمات.
5. استخدم 🔊 النطق لتثبيت الصوت.

DeutschDrop يجمع الحفظ، المراجعة، النطق، الكتابة، والتدريب في مكان واحد داخل تيليگرام.`;
}

function onboardingKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ أضف أول كلمة', 'add_word')
        .text('📤 رفع CSV', 'upload_csv').row()
        .text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function helpText(): string {
    return `❓ طريقة استخدام DeutschDrop

1. إضافة الكلمات
يمكنك إضافة كلمة يدوياً:
Haus = بيت

أو رفع ملف CSV بصيغة:
German,Arabic,Example

2. المراجعة
استخدم 📚 راجع الآن لمراجعة الكلمات حسب التكرار الذكي.

3. التدريب
استخدم 🏋️ تدريب لاختبار نفسك:

* مختلط
* كتابة
* حروف ناقصة
* ألماني → عربي
* عربي → ألماني
* الكلمات التي أخطأت بها
* الكلمات الصعبة

4. النطق
اضغط 🔊 نطق لسماع الكلمة بالألماني داخل البوت.

5. الإشعارات
فعّل 🔔 الإشعارات حتى تصلك كلمات للمراجعة بدل تذكير عام.

6. الكلمات الصعبة
إذا أخطأت بكلمة أكثر من مرة، تدخل في تدريب خاص حتى تثبت.

7. الدعم
إذا أردت دعم المشروع، افتح 💙 دعم المشروع.`;
}

function helpKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ إضافة كلمة', 'add_word')
        .text('📤 رفع CSV', 'upload_csv').row()
        .text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('🔔 الإشعارات', 'menu_notifications')
        .text('💙 دعم المشروع', 'menu_support').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

export function levelSelectionKeyboard(backCallback: string = 'menu_main'): InlineKeyboard {
    return new InlineKeyboard()
        .text('A1', 'level_set_A1')
        .text('A2', 'level_set_A2')
        .text('B1', 'level_set_B1').row()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}

export async function showLevelSelection(ctx: BotContext, intro: string = 'حدد مستواك:'): Promise<void> {
    await replaceWithText(ctx, `🎚 *${intro}*\n\nA1\nA2\nB1`, levelSelectionKeyboard(), 'Markdown');
}

export async function showOnboarding(ctx: BotContext): Promise<void> {
    await replaceWithText(ctx, onboardingText(), onboardingKeyboard());
}

function trainMenuText(): string {
    return `🏋️ *التدريب*\n\n` +
        `اختر نوع التدريب:\n\n` +
        `الافتراضي الأفضل هو 🎲 مختلط.`;
}

async function clearTrainingAndEditSessions(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;
    await deleteBotSession(ctx.db, user.user_id, 'word_edit');
    await deleteBotSession(ctx.db, user.user_id, 'add_word');
    await deleteBotSession(ctx.db, user.user_id, 'word_search');
    await deleteBotSession(ctx.db, user.user_id, 'train');
    await deleteBotSession(ctx.db, user.user_id, 'train_explain');
    await deleteBotSession(ctx.db, user.user_id, 'collection_add_word_direct');
    await deleteBotSession(ctx.db, user.user_id, 'collection_csv_upload');
    await deleteBotSession(ctx.db, user.user_id, 'collection_add_existing_words');
}

async function clearTextInteractionSessions(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;
    await deleteBotSession(ctx.db, user.user_id, 'word_edit');
    await deleteBotSession(ctx.db, user.user_id, 'add_word');
    await deleteBotSession(ctx.db, user.user_id, 'word_search');
    await deleteBotSession(ctx.db, user.user_id, 'collection_add_word_direct');
    await deleteBotSession(ctx.db, user.user_id, 'collection_csv_upload');
    await deleteBotSession(ctx.db, user.user_id, 'collection_add_existing_words');
}
