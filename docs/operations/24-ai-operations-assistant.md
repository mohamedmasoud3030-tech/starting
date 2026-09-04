# 24 — مساعد «لينا» التشغيلي (AI Operations Assistant)

وصف مختصر لميزة المساعد الذكي لمالك مكتب الضيافة، وبنيتها ونشرها.

## الغرض

المساعد هو الشريك التشغيلي اليومي للمالك: بضغطة زر (فلوتنج في الزاوية) يسأله
عن أولويات اليوم، جاهزية المناسبات، المتبقي من التحصيل، والموردون والمشتريات.
الردود تظهر **لايف** (مؤشر كتابة متحرك) وتُقرأ بصوت عربي أنثوي طبيعي عبر محرك
نطق المساعد الخاص (لا صوت للشاشة).

> ملاحظة: أُزيلت ميزة «قارئ/ناطق الشاشة» (Owner Voice) بالكامل من الواجهة —
> وهي الموجودة فقط في المساعد الآن. مساعدات التاريخ العامة (`isSameLocalDay`
> و`DEFAULT_TIME_ZONE`) انتقلت إلى `src/lib/dates.ts`، والمساعتدات العربية
> (`EVENT_STATUS_ARABIC` و`toArabicDigits`) إلى `src/lib/arabic.ts`.

## المبادئ

- **قاعدة البيانات هي مصدر الحقيقة**: كل الأرقام تأتي من دوال SQL الأساسية
  (`management_metrics`، `management_alerts`، `today_collections`) التي تحترم
  RLS ودور المستخدم. لا حساب ولا تجميع ولا تحديد نطاق منظمة في الواجهة.
- **قراءة فقط**: المساعد لا ينفّذ أي كتابة ولا يدّعي تنفيذ إجراء.
- **مقفول بالأمان على الخادم**: edge function تتحقق من الجلسة ثم تعيد قراءة
  السياق عبر PostgREST تحت دور المستخدم نفسه، ثم تضيف قاعدة المعرفة وتستدعي
  الموديل. مفتاح المزوّد لا يصل إلى المتصفح أبداً.
- **يعمل حتى بلا مفتاح مزوّد**: إن لم تُضبط `AI_PROVIDER_*`، يردّ المساعد
  بردّ حتمي من المقاييس (لا وحدات وهمية — يبقى حقيقياً ومفيداً).

## البنية

```
src/features/assistant/
  AssistantLauncher.tsx      الزر العائم + لوحة المحادثة (لايف)
  use-assistant.ts           حالة المحادثة (بناء سياق + إرسال)
  operations-context.ts      تجميع لقطة السياق من الدوال الأساسية (fail-soft)
  assistant-api.ts           استدعاء edge function عبر supabase.functions.invoke
  assistant-identity.ts      هوية المساعد (الاسم/النطاق/الإسناد)
  assistant-types.ts         الأنواع المشتركة
  assistant-speech.ts        محرك نطق المساعد (صوت عربي أنثوي طبيعي)
  use-assistant-voice.ts     ربط React لمحرك النطق

supabase/functions/ai-assistant/index.ts     edge function (مصادقة + سياق خادمي + موديل)
supabase/functions/_shared/hospitality-kb.ts قاعدة المعرفة القطاعية المرقّمة
```

`AssistantLauncher` مضمّن في `AppShell` لذلك يظهر في كل الصفحات التي يملك فيها
المستخدم منظمة نشطة؛ خارج ذلك لا يعرض شيئاً.

## نشر edge function

الـ function تأخذ بيئات خادمية فقط (لا تضعها في `.env` للعميل):

```
AI_PROVIDER_API_KEY   <مفتاح مزوّد متوافق مع OpenAI>
AI_PROVIDER_MODEL     <اسم الموديل، مثل gpt-4o-mini>
SUPABASE_URL          <رابط مشروعك>
SUPABASE_ANON_KEY     <مفتاح anon>
```

ثم النشر:

```bash
supabase functions deploy ai-assistant
```

بعد النشر، من `supabase/functions` تُستدعى تلقائياً باسم `ai-assistant`.

## الاختبارات

`src/features/assistant/*.test.ts` تختبر: الهوية، تجميع السياق (بما فيها حالات
الانهيار)، تسوية رد الـ API، ولوحة المهام (فتح/إرسال/قراءة الرد).
