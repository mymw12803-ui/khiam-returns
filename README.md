# مرتجعات خيام

امسح باركود بوليصة Bosta ← يجلب الموقع وصف الشحنة والملحوظة من حسابيك ← يطابقهم مع منتجات khiam.store ويعرض الصور واللون/المقاس والكمية.

## 1) تجربة محلية
1. ضع المفتاحين في ملف `.env` (`BOSTA_API_KEY_1` و `BOSTA_API_KEY_2`).
2. `node server.mjs` ثم افتح http://localhost:8799
3. تحديث المنتجات: `node scripts/sync-products.mjs`

## 2) النشر
GitHub Pages موقع **ثابت** — لا تضع المفاتيح فيه أبداً (أي شخص يستطيع قراءتها). لذلك:

**أ. الـ API (Cloudflare Worker مجاني) — يحمل المفاتيح كأسرار**
```bash
cd worker
npx wrangler login
npx wrangler secret put BOSTA_API_KEY_1
npx wrangler secret put BOSTA_API_KEY_2
npx wrangler deploy
```
انسخ الرابط الناتج (`https://khiam-returns-api.xxx.workers.dev`). يُفضّل فتح `wrangler.toml` وتفعيل `ALLOWED_ORIGIN` بعنوان موقعك على github.io.

**ب. الموقع على GitHub Pages**
1. ضع رابط الـ Worker في `config.js` (`API_BASE`).
2. ارفع المشروع إلى مستودع (ملف `.env` مُستثنى تلقائياً عبر `.gitignore`).
3. Settings ← Pages ← Deploy from branch ← `main` / root.
4. تحديث قائمة المنتجات يومياً تلقائياً عبر `.github/workflows/sync.yml` (أو شغّله يدوياً من Actions).

## ملاحظات
- المطابقة تعتمد على اسم المنتج + اللون/المقاس + الكود بين الأقواس مثل `(Y2)`؛ إن لم يتحدد الشكل بدقة يعرض الاحتمالات.
- مربع «بحث يدوي» يطابق أي نص بدون API.
- نقطة جلب الشحنة في `worker/bosta.js` تجرّب عدة صيغ لـ Bosta API؛ لو فشلت كلها مع مفتاح صحيح أرسل لي الرد وسأضبطها.
