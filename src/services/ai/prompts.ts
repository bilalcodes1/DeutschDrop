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
        return `${RULES}\n\nالمهمة: ولّد مثال ألماني بسيط، ترجمته العربية، لفظ الكلمة الألمانية بحروف عربية، ومستوى تقريبي.\n` +
            `أمثلة لفظ: Haus=هاوس, Auto=آوتو, Buch=بوخ, Schule=شوله, sprechen=شبريخن, ich=إِخ, nicht=نِشت, Mädchen=ميدشن, Deutschland=دويتشلاند.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"example_de":"...","example_ar":"...","pronunciation_ar":"...","level":"A1"}`;
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

    return `${RULES}\n\nالمهمة: صنّف مستوى الكلمة الألمانية A1/A2/B1 أو Unknown مع سبب قصير بالعربي.\n` +
        `المدخل: ${safeInput}\n` +
        `الإخراج JSON فقط:\n{"level":"A1","reason":"..."}`;
}
