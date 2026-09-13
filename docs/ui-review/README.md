# المعاينة البصرية — 2026-09-13

لقطات حقيقية من `jiwdah.vercel.app` بحساب الديمو، بمتصفح Chromium:
- `n-*.png` موبايل (iPhone 13) بعد تصليح المراحل.
- `e-*.png` / `dg*.png` سطح المكتب 1440×900 (قبل وبعد).
- `wh-*.png` صفحة المخزن (العدة | المواد) بعد الدمج.
- `verify.png` / `desktop-after.png` / `warehouse-after.png` لوحات مجمّعة.

السكربتات (`*.mjs`) تعيد إنتاج اللقطات:
```
npm i playwright@1.47 && npx playwright install chromium
node shoot.mjs   # موبايل
node desktop.mjs # ديسكتوب
```
