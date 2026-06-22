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
            `- pronunciation_latin يجب أن يكون لفظ german الأصلي فقط، وليس لفظ example_de.\n` +
            `- pronunciation_ar يجب أن يكون مبنياً صوتياً على pronunciation_latin، وليس تخميناً مستقلاً.\n` +
            `- استخدم الحركات العربية قدر الإمكان: َ ِ ُ ْ ّ.\n` +
            `- مسموح استخدام گ للصوت g، ڤ للصوت v، پ للصوت p، چ إذا احتاج.\n` +
            `- sch = ش، z الألمانية = تس، sp/st في بداية الكلمة = شپ/شت، ich = إِخْ، Buch = بوخ.\n` +
            `- example_ar يجب أن يكون ترجمة example_de، وليس ترجمة عشوائية.\n` +
            `- level يكون حسب german الأصلي فقط: A1 أو A2 أو B1 أو Unknown.\n` +
            `مثال صحيح لمدخل german="richtig gut in Schuss" arabic="بحالة جيدة جداً":\n` +
            `{"example_de":"Das Auto ist richtig gut in Schuss.","example_ar":"السيارة بحالة جيدة جداً.","pronunciation_latin":"RIKH-tikh goot in shoos","pronunciation_ar":"رِخْتِش گوت إِن شوس","level":"B1"}\n` +
            `ممنوع مثال مثل Ich bin froh إذا german لا يحتوي ich/bin/froh.\n` +
            `أمثلة لفظ إلزامية: Haus Latin=hows Arabic=هاوس, Auto Latin=OW-toh Arabic=آوتو, Schule Latin=SHOO-luh Arabic=شُولَه, ich Latin=ikh Arabic=إِخْ, nicht Latin=nikht Arabic=نِخت, sprechen Latin=SHPREH-khen Arabic=شپرِخِن, Deutschland Latin=DOYTCH-lahnt Arabic=دويتشلاند, Mädchen Latin=MET-khen Arabic=مِتخِن, richtig Latin=RIKH-tikh Arabic=رِخْتِش, gut Latin=goot Arabic=گوت, in Schuss Latin=in shoos Arabic=إِن شوس, Wir lernen uns kennen Latin=veer LER-nen oons KEN-nen Arabic=ڤير لِرْنِن أونس كِنِّن.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"example_de":"...","example_ar":"...","pronunciation_latin":"...","pronunciation_ar":"...","level":"A1|A2|B1|Unknown"}`;
    }

    if (taskType === 'generate_pronunciation') {
        return `${RULES}\n\nالمهمة: اكتب لفظ الكلمة الألمانية بحروف عربية بشكل عملي.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n{"pronunciation_ar":"...","note":null}`;
    }

    if (taskType === 'explain_answer') {
        return `${RULES}\n\nالمهمة: اشرح الخطأ بالعراقي البسيط بجملتين أو ثلاث فقط.\n` +
            `قواعد صارمة:\n` +
            `- الشرح عن german/correctAnswer فقط.\n` +
            `- extra_example_de يجب أن يحتوي correctAnswer أو german أو أهم tokens منه.\n` +
            `- لا تعطِ مثال عشوائي مثل Stille Nacht إلا إذا السؤال عنها.\n` +
            `- JSON فقط.\n` +
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

    if (taskType === 'generate_life_sentence') {
        return `${RULES}\n\nالمهمة: حوّل موقفاً عربياً حقيقياً من يوم المستخدم إلى جملة ألمانية طبيعية وشائعة.\n` +
            `قواعد صارمة:\n` +
            `- حافظ على معنى المستخدم ولا تخترع حدثاً مختلفاً.\n` +
            `- german إلزامي وجملة ألمانية طبيعية لا تتجاوز 20 كلمة إلا للضرورة.\n` +
            `- arabic ترجمة عربية دقيقة للجملة الألمانية.\n` +
            `- pronunciation_ar لفظ مبسط بحروف عربية للجملة الألمانية.\n` +
            `- memory_hint تلميح قصير للتذكر.\n` +
            `- keywords بين 1 و5 عناصر بصيغة {"german":"...","arabic":"..."}.\n` +
            `- level يجب أن يكون A1 أو A2 أو B1 حسب target_level ومعنى الجملة.\n` +
            `- tense يكون present أو past أو future أو mixed.\n` +
            `- لا تستخدم Markdown ولا code fences ولا شرح خارج JSON.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط:\n` +
            `{"german":"Heute war es sehr heiß.","arabic":"اليوم كان الجو حاراً جداً.","pronunciation_ar":"هويته فار إس زير هايس","memory_hint":"heiß تعني حار","keywords":[{"german":"heiß","arabic":"حار"}],"level":"A1","tense":"present","notes":""}`;
    }

    return `${RULES}\n\nالمهمة: صنّف مستوى الكلمة الألمانية A1/A2/B1 أو Unknown مع سبب قصير بالعربي.\n` +
        `المدخل: ${safeInput}\n` +
        `الإخراج JSON فقط:\n{"level":"A1","reason":"..."}`;
}
