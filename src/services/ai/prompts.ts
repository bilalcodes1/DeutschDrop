import type { AiTaskInput, AiTaskType } from './aiTypes';

const RULES = [
    'رجّع JSON فقط عندما يُطلب JSON.',
    'لا تستخدم Markdown داخل JSON.',
    'لا تكتب شرح خارج JSON.',
    'لا تذكر أنك نموذج ذكاء صناعي.',
    'لا ترسل كلام طويل.',
    'ركّز فقط على تعلم الألمانية.',
    'الشرح يكون عربي عراقي بسيط.',
    'الأمثلة الألمانية تكون A1/A2 قدر الإمكان.',
    'لفظ الكلمة بحروف عربية لازم يكون قريب من النطق الألماني ومفيد للعراقي/العربي.',
    'لا تستخدم محتوى حساس أو سياسي أو ديني.',
    'لا تخترع معنى مختلف عن الكلمة.',
].join('\n');

export function buildPrompt(taskType: AiTaskType, input: AiTaskInput): string {
    const safeInput = JSON.stringify(input);

    if (taskType === 'generate_example_and_pronunciation') {
        return `${RULES}\n\nالمهمة: حسّن الكلمة/العبارة الألمانية الأصلية فقط، ولا تستبدلها بكلمة ثانية.\n` +
            `Input يحتوي german = النص الألماني الأصلي و arabic = معناه العربي.\n` +
            `قواعد صارمة:\n` +
            `- example_de يجب أن يحتوي german الأصلي كما هو إذا كان ممكناً.\n` +
            `- إذا german عبارة طويلة، استخدمها داخل جملة ألمانية قصيرة.\n` +
            `- لا تستبدل german بكلمة مرادفة أو معنى مختلف.\n` +
            `- لا تولد مثال لمعنى آخر.\n` +
            `- pronunciation_ar يجب أن يكون لفظ german الأصلي فقط، وليس لفظ example_de.\n` +
            `- example_ar يجب أن يكون ترجمة example_de، وليس ترجمة عشوائية.\n` +
            `- level يكون حسب german الأصلي فقط: A1 أو A2 أو B1 أو Unknown.\n` +
            `مثال صحيح لمدخل german="richtig gut in Schuss" arabic="بحالة جيدة جداً":\n` +
            `{"example_de":"Das Auto ist richtig gut in Schuss.","example_ar":"السيارة بحالة جيدة جداً.","pronunciation_ar":"رِشتِش گوت إِن شوس","level":"B1"}\n` +
            `ممنوع مثال مثل Ich bin froh إذا german لا يحتوي ich/bin/froh.\n` +
            `أمثلة لفظ: Haus=هاوس, Auto=آوتو, Buch=بوخ, Schule=شوله, sprechen=شبريخن, ich=إِخ, nicht=نِشت, Mädchen=ميدشن, Deutschland=دويتشلاند.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"example_de":"...","example_ar":"...","pronunciation_ar":"...","level":"A1|A2|B1|Unknown"}`;
    }

    if (taskType === 'generate_pronunciation') {
        return `${RULES}\n\nالمهمة: اكتب لفظ الكلمة الألمانية بحروف عربية بشكل عملي.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"pronunciation_ar":"...","note":null}`;
    }

    if (taskType === 'explain_answer') {
        return `${RULES}\n\nالمهمة: اشرح الخطأ بالعراقي البسيط بجملتين أو ثلاث فقط.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"short_explanation":"...","correct_answer":"...","extra_example_de":"...","extra_example_ar":"..."}`;
    }

    if (taskType === 'grade_training_answer') {
        return `${RULES}\n\nالمهمة: قيّم جواب تدريب كتابي فقط.\n` +
            `قواعد صارمة:\n` +
            `- قيّم هل جواب المستخدم يؤدي نفس المعنى المطلوب.\n` +
            `- لا تكن صارماً في capital letters.\n` +
            `- لا تعتبر اختلاف الأقواس خطأ إذا المعنى نفسه.\n` +
            `- لا تقبل جواباً بمعنى مختلف.\n` +
            `- في الألماني، لا تقبل كلمة مختلفة حتى لو قريبة.\n` +
            `- في العربي، اقبل الصياغة المرادفة إذا نفس المعنى.\n` +
            `- short_feedback بالعربي العراقي البسيط، جملة واحدة فقط.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"is_correct":true,"confidence":0.85,"verdict":"correct","short_feedback":"..."}`;
    }

    return `${RULES}\n\nالمهمة: صنّف مستوى الكلمة الألمانية A1/A2/B1 أو Unknown مع سبب قصير بالعربي.\n` +
        `المدخل: ${safeInput}\n` +
        `الإخراج JSON فقط:\n{"level":"A1","reason":"..."}`;
}
