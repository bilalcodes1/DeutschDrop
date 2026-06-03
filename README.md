# DeutschDrop

بوت تيليجرام لتعلم المفردات الألمانية باستخدام التكرار المتباعد (SRS) ونظام نقاط XP.

## التقنيات

- **Backend:** Cloudflare Workers + TypeScript
- **Bot:** grammy.js
- **Database:** Cloudflare D1 (SQLite)
- **Storage:** Cloudflare R2 (جاهز للصوت مستقبلاً)
- **Cron:** Cloudflare Scheduled Jobs

## الأوامر

| الأمر | الوصف |
|-------|-------|
| `/start` | تسجيل المستخدم + اختيار بلال/ملاك + إعداد الخطة اليومية |
| `/learn` | مراجعة الكلمات المستحقة (SRS) |
| `/train` | وضع التدريب بأنواع متعددة |
| `/addword` | إضافة كلمة يدوياً |
| `/upload` | رفع ملف CSV |
| `/stats` | الإحصائيات والمستوى |
| `/leaderboard` | لوحة الترتيب |
| `/challenge` | تحدي غير متزامن بين بلال وملاك |
| `/hard_words` | عرض وتدريب الكلمات الصعبة |
| `/export` | تصدير كلماتك إلى CSV |
| `/settings` | الإعدادات |
| `/menu` | القائمة الرئيسية |

## هيكل المشروع

```
src/
├── index.ts              # نقطة دخول الـ Worker
├── routes/
│   └── webhook.ts        # معالج Webhook
├── models/
│   └── index.ts          # أنواع TypeScript
├── repositories/         # طبقة الوصول للبيانات
├── services/             # المنطق التجاري
├── commands/             # معالجات أوامر Telegram
├── bot/
│   ├── bot.ts            # إعداد grammy
│   └── context.ts        # سياق مخصص
└── db/
    ├── schema.sql        # مخطط D1
    └── migrations/       # D1 migrations
```

## التشغيل المحلي

```bash
# تثبيت الحزم
npm install

# تطبيق المخطط محلياً
npm run db:migrate:local

# تشغيل محلي
npm run dev
```

## النشر

### 1. إنشاء قاعدة بيانات D1

```bash
npx wrangler d1 create deutschdrop-db
```

انسخ `database_id` الناتج إلى `wrangler.toml` مكان `REPLACE_WITH_D1_DATABASE_ID`.

### 2. تطبيق المخطط

```bash
npx wrangler d1 migrations apply deutschdrop-db
```

المخطط الأساسي موجود في:

```text
src/db/schema.sql
src/db/migrations/0001_initial.sql
```

### 3. تعيين secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```

### 4. النشر

```bash
npm run deploy
```

### 5. ربط Webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_WORKER>.workers.dev/webhook"
```

## Implemented

- [x] تسجيل المستخدمين + إعداد الخطة
- [x] إضافة كلمات يدوية + رفع CSV
- [x] CSV parsing آمن للحقول المقتبسة والفواصل داخل المثال
- [x] SRS ديناميكي (SM-2)
- [x] وضع التدريب باختيارات متعددة حقيقية
- [x] XP + نظام Levels
- [x] لوحة الترتيب
- [x] إنجازات أساسية مع XP وإشعار للطرف الثاني
- [x] تحديات غير متزامنة بين بلال وملاك
- [x] مهام يومية بسيطة داخل الإحصائيات والملخص اليومي
- [x] شاشة الكلمات الصعبة
- [x] تصدير كلمات المستخدم بصيغة CSV
- [x] جلسات تعلم وتدريب وإضافة كلمات persistent في D1
- [x] السلسلة اليومية
- [x] Cron Jobs (إشعارات المراجعة + ملخص + تحديث السلاسل + تنظيف الجلسات)

## Planned

- [ ] TTS / الصوت
- [ ] R2 Storage للصوت

## الترخيص

MIT
