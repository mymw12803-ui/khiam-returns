# مرتجعات خيام

امسح باركود بوليصة Bosta ← يعرض الموقع **فقط ما يجب استلامه** داخل الطرد (صورة + لون/مقاس + كود SKU + الكمية) ← الموظف يعدّ ما استلمه ويضغط «تم التحقق» ← في النهاية تقرير يُنسخ أو يُنزَّل Excel.

## كيف يحدد المطلوب استلامه
| نوع الشحنة في Bosta | المطلوب استلامه | بقي مع العميل |
|---|---|---|
| Return to Origin (أوردر مرفوض) | كل ما في وصف الشحنة | — |
| Customer Return Pickup (استرجاع) | كل ما في وصف الشحنة | — |
| Exchange (استبدال تم) | المنتج القديم المكتوب في **الملحوظة** (يُعرف بالـ SKU) | ما في وصف الشحنة |
| Exchange + ملصق RTO (استبدال مرفوض) | ما في وصف الشحنة | المنتج القديم |

- الاستبدال المرفوض يُحدد حالياً بخانة «الطرد عليه ملصق RTO» في الصفحة.
- إذا لم تُحدَّد كل المنتجات بالقواعد (ملحوظة بدون كود، أو اسم غير واضح) يُستدعى **Gemini** تلقائياً.

## الملفات
- `index.html` `app.js` `match.js` `style.css` `config.js` `data/products.json`: الموقع (GitHub Pages).
- `worker/index.js`: الـ Worker (ملف واحد: Bosta + Gemini). **لا يُرفع على GitHub Pages كموقع، بل يُلصق في Cloudflare.**
- `.env`: مفاتيحك للتجربة المحلية (مستثنى من GitHub عبر `.gitignore`).

## تحديث الـ Worker (بدون أي برامج)
1. dash.cloudflare.com ← Workers & Pages ← `khiam-returns-api` ← **Edit code**.
2. احذف الكود الموجود والصق محتوى `worker/index.js` كاملاً ← **Deploy**.
3. Settings ← Variables and Secrets ← **Add** ← النوع Secret ← الاسم `GEMINI_API_KEY` ← الصق المفتاح ← Deploy.
4. للتأكد افتح: `https://khiam-returns-api.mymw12803.workers.dev/api/health` ويجب أن يظهر `"ai":true`.

(أو بالأوامر إن كان Node.js مثبتاً: `cd worker` ثم `npx wrangler secret put GEMINI_API_KEY` ثم `npx wrangler deploy`.)

## تحديث الموقع على GitHub
ارفع الملفات: `index.html` `app.js` `match.js` `style.css` `README.md` `worker/index.js` `worker/wrangler.toml` `server.mjs` واحذف `worker/bosta.js`.

## تجربة محلية (تحتاج Node.js 18+)
`node server.mjs` ثم افتح http://localhost:8799 — يستخدم المفاتيح من `.env`.

## ملاحظات
- السجل محفوظ في متصفح الجهاز نفسه؛ نزّل ملف Excel قبل «مسح السجل».
- تحديث قائمة المنتجات يومياً تلقائياً عبر `.github/workflows/sync.yml`. يوجد 7 أشكال بلا SKU في Shopify (اسدال بخمار أطفالي مشجر C1/C2/C3، وخمار مشجر بأكمام بيج D3 الأول) — أضف لها أكواداً.
- `/api/shipment/<رقم>?inspect` يعرض بيانات Bosta الخام بدون أي بيانات شخصية (للفحص).
