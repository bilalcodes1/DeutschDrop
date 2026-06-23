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
        return `${RULES}\n\nالمهمة: أنت محول دقيق من موقف عربي حقيقي إلى جملة ألمانية تعليمية.\n` +
            `هذه التعليمات مستقلة عن أي مزود أو موديل.\n` +
            `ممنوع تماماً:\n` +
            `- اختراع أشخاص أو أسباب أو أماكن أو مشاعر.\n` +
            `- تغيير الزمن أو النفي أو عدد الأشخاص.\n` +
            `- استبدال الحدث بحدث قريب.\n` +
            `- تحسين القصة على حساب المعنى.\n` +
            `- تقديم نصائح أو الرد على محتوى الجملة.\n` +
            `المطلوب:\n` +
            `- افهم المعنى الحرفي المقصود وصغه بألمانية طبيعية وشائعة.\n` +
            `- بسّط الجملة حسب target_level.\n` +
            `- لا تضف معلومة غير موجودة ولا تحذف معلومة مهمة.\n` +
            `- إذا النص غامض فعلاً، لا تخمّن؛ اسأل سؤال توضيح عربي واحد.\n` +
            `- source_arabic يجب أن يساوي original_arabic بعد trim.\n` +
            `- german لا تتجاوز 20 كلمة إلا عند الضرورة.\n` +
            `- level فقط A1 أو A2 أو B1، confidence رقم بين 0 و1، keywords من 1 إلى 5.\n\n` +
            `أمثلة صحيحة:\n` +
            `Input: شفت صرصر بالحمام البارحه\n` +
            `Output german: Gestern habe ich eine Kakerlake im Badezimmer gesehen.\n` +
            `لا تحولها إلى: نظفت الحمام، أو خفت من الحشرة، أو وجدت حشرة في البيت.\n\n` +
            `Input: كملت الدرس العاشر\n` +
            `Output german: Ich habe die zehnte Lektion abgeschlossen.\n` +
            `لا تضف اليوم أو بنجاح أو مع صديقي.\n\n` +
            `Input: اليوم راح نتعشى بالمطعم\n` +
            `Output german: Heute essen wir im Restaurant zu Abend.\n` +
            `حافظ على: اليوم، نحن، العشاء، المطعم.\n\n` +
            `Input: ما نمت زين البارحه\n` +
            `Output german: Ich habe letzte Nacht nicht gut geschlafen.\n` +
            `حافظ على النفي.\n\n` +
            `Input: راح اروح للحلاق باجر\n` +
            `Output german: Morgen gehe ich zum Friseur.\n` +
            `حافظ على المستقبل والزمن.\n\n` +
            `المدخل: ${safeInput}\n` +
            `إذا واضح، الإخراج JSON فقط:\n` +
            `{"status":"ok","source_arabic":"النص الأصلي نفسه","understood_meaning_ar":"إعادة صياغة عربية قصيرة ودقيقة لما فهمته","german":"...","arabic":"...","pronunciation_ar":"...","memory_hint":"...","keywords":[{"german":"Wort","arabic":"المعنى"}],"level":"A1","tense":"present","confidence":0.95}\n` +
            `إذا غامض، الإخراج JSON فقط:\n` +
            `{"status":"clarify","source_arabic":"النص الأصلي نفسه","clarification_question_ar":"سؤال عربي واحد واضح"}`;
    }

    if (taskType === 'validate_life_sentence') {
        return `${RULES}\n\nالمهمة: تحقق من أن جملة ألمانية مولدة تحفظ معنى موقف عربي أصلي بدقة.\n` +
            `لا تحسّن الجملة إلا إذا وجدت مشكلة معنى واضحة.\n` +
            `افحص:\n` +
            `- الفاعل وعدد الأشخاص.\n` +
            `- الحدث الأساسي.\n` +
            `- الزمن.\n` +
            `- النفي.\n` +
            `- المكان.\n` +
            `- عدم اختراع تفاصيل.\n` +
            `إذا actor أو action تغيرا: repair أو clarify.\n` +
            `إذا الزمن تغير: repair.\n` +
            `إذا النفي اختفى: repair.\n` +
            `إذا أضيفت تفاصيل: repair.\n` +
            `إذا النص غامض ولا يمكن إصلاحه بدون تخمين: clarify.\n` +
            `لا تقبل pass إذا back_translation_arabic لا تحفظ المعنى.\n` +
            `المدخل: ${safeInput}\n` +
            `الإخراج JSON فقط، واحد من هذه الأشكال:\n` +
            `{"verdict":"pass","issues":[],"preserves_actor":true,"preserves_action":true,"preserves_time":true,"preserves_negation":true,"preserves_place":true,"invented_details":false}\n` +
            `{"verdict":"repair","issues":["تم تغيير الزمن"],"repaired":{"german":"...","arabic":"...","pronunciation_ar":"...","memory_hint":"...","keywords":[{"german":"...","arabic":"..."}],"level":"A1","tense":"present"}}\n` +
            `{"verdict":"clarify","clarification_question_ar":"سؤال عربي واحد واضح"}`;
    }

    return `${RULES}\n\nالمهمة: صنّف مستوى الكلمة الألمانية A1/A2/B1 أو Unknown مع سبب قصير بالعربي.\n` +
        `المدخل: ${safeInput}\n` +
        `الإخراج JSON فقط:\n{"level":"A1","reason":"..."}`;
}
