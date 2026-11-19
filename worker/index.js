// Cloudflare Worker لمرتجعات خيام — ملف واحد كامل.
// يمكن لصقه كما هو في محرر Cloudflare (Workers → khiam-returns-api → Edit code) ثم Deploy.
// الأسرار المطلوبة (Settings → Variables and Secrets):
//   BOSTA_API_KEY_1 , BOSTA_API_KEY_2 , GEMINI_API_KEY
// متغيرات اختيارية: GEMINI_MODEL (الافتراضي gemini-3.5-flash-lite) , ALLOWED_ORIGIN

// ════════════════ Bosta ════════════════
const BOSTA = "https://app.bosta.co/api/v2";

// عدة صيغ محتملة لنقطة الجلب؛ أول صيغة تنجح يتم تذكّرها
const STRATEGIES = [
  (tn) => ({ method: "POST", url: `${BOSTA}/deliveries/search`, body: { trackingNumbers: tn, pageId: 1, pageLimit: 5 } }), // ✔ مؤكدة بالتجربة
  (tn) => ({ method: "GET", url: `${BOSTA}/deliveries/business/${tn}` }),
  (tn) => ({ method: "GET", url: `${BOSTA}/deliveries/${tn}` }),
];
let working = null;

function findDelivery(node, tn) {
  if (!node || typeof node !== "object") return null;
  if (String(node.trackingNumber ?? "") === tn) return node;
  for (const v of Object.values(node)) {
    const r = findDelivery(v, tn);
    if (r) return r;
  }
  return null;
}

// لا نُرجع هاتف العميل ولا عنوانه ولا مبلغ التحصيل: الموقع لا يحتاجها
function normalize(d) {
  const pd = d.specs?.packageDetails || d.packageDetails || {};
  return {
    trackingNumber: String(d.trackingNumber),
    description: pd.description || "",
    itemsCount: pd.itemsCount ?? null,
    notes: d.notes || "",
    businessReference: d.businessReference || "",
    type: d.type?.value || d.type || "",
    typeCode: d.type?.code ?? null,
    state: d.state?.value || d.state?.code || d.state || "",
    stateCode: d.state?.code ?? null,
    receiverName: d.receiver?.fullName || d.receiver?.firstName || "",
  };
}

// نسخة من بيانات Bosta الخام بدون أي بيانات شخصية — للفحص فقط (?inspect)
const PII = /phone|mobile|address|receiver|consignee|sender|name|email|national|geo|location|lat|lng|coordinat|signature|image|photo|otp|pin|street|building|floor|apartment|landmark|district|city|zone|token|password/i;
function sanitize(v, depth = 0) {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => sanitize(x, depth + 1));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!PII.test(k)) o[k] = sanitize(x, depth + 1);
    return o;
  }
  if (typeof v === "string" && v.length > 300) return v.slice(0, 300) + "…";
  return v;
}

function extractTracking(text) {
  const runs = String(text || "").match(/\d{6,}/g);
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : null;
}

async function lookup(env, tn, { debug = false, inspect = false } = {}) {
  const keys = [env.BOSTA_API_KEY_1, env.BOSTA_API_KEY_2].map((k) => (k || "").trim());
  const attempts = [];
  const all = STRATEGIES.map((_, i) => i);
  const order = working === null ? all : [working, ...all.filter((i) => i !== working)];
  for (let a = 0; a < keys.length; a++) {
    if (!keys[a]) continue;
    for (const i of order) {
      const s = STRATEGIES[i](tn);
      try {
        const res = await fetch(s.url, {
          method: s.method,
          headers: { Authorization: keys[a], "Content-Type": "application/json" },
          body: s.body ? JSON.stringify(s.body) : undefined,
        });
        attempts.push({ account: a + 1, strategy: i, status: res.status });
        if (res.status === 401 || res.status === 403) break; // المفتاح مرفوض
        if (!res.ok) continue;
        const d = findDelivery(await res.json().catch(() => null), tn);
        if (d) {
          working = i;
          return {
            found: true,
            account: a + 1,
            delivery: normalize(d),
            ...(debug ? { attempts } : {}),
            ...(inspect ? { inspect: sanitize(d) } : {}),
          };
        }
      } catch (e) {
        attempts.push({ account: a + 1, strategy: i, error: String(e) });
      }
    }
  }
  return { found: false, configuredKeys: keys.filter(Boolean).length, ...(debug ? { attempts } : {}) };
}

// ════════════════ الذكاء الاصطناعي (Gemini) ════════════════
const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // الأخف والأسرع

const SYSTEM = `أنت مساعد في مخزن متجر ملابس محجبات اسمه "خيام". تحلل بوليصة شحن Bosta رجعت للمخزن، وتحدد بالضبط المنتجات الموجودة داخل الطرد التي يجب أن يستلمها موظف المخزن.

القواعد حسب scenario:
- rto (أوردر رفضه العميل) أو return (استرجاع): كل ما في "وصف الشحنة" يرجع. الملحوظة تعليمات للمندوب وليست منتجات.
- exchange (استبدال تم): "وصف الشحنة" = المنتجات الجديدة التي ذهبت للعميل وبقيت معه (kept). المرتجع (expected) هو المنتج القديم المذكور في "الملحوظة"، غالباً بعد سبب الاستبدال وكود SKU. عبارة "اضافة منتج" تعني أن منتجاً زائداً ذهب للعميل ولن يرجع.
- exchangeRefused (العميل رفض الاستبدال): العكس؛ ما في الوصف يرجع (expected)، وما في الملحوظة بقي مع العميل (kept).
- إذا كانت الملحوظة كلاماً حراً بلا كود، استنتج المنتج القديم من الوصف والملحوظة معاً: غالباً نفس المنتج بلون أو مقاس آخر تذكره الملحوظة. مثال: الوصف "خمار - كحلي / الثاني" والملحوظة "غير المقاس كان اول" → المرتجع "خمار - كحلي / الاول".
- المقاسات: الاول/الثاني/الثالث/الرابع. الأكواد بين قوسين مثل (Q2) أو (Y1) جزء من اسم اللون.
- الكمية من (n QTY)، وإلا 1.

استخدم فقط منتجات الكتالوج. اكتب sku كما هو في الكتالوج؛ وإن كان الشكل بلا SKU (مكتوب "-") اكتب title واسم الشكل variant بالضبط.
إذا لم تستطع تحديد منتج بثقة، ضع نص السطر في unknown ولا تخترع.

أعد JSON فقط بهذا الشكل:
{"expected":[{"sku":"","title":"","variant":"","qty":1,"why":""}],"kept":[{"sku":"","title":"","variant":"","qty":1}],"unknown":[""],"confidence":"high|medium|low","message":"جملة قصيرة بالعربية للموظف"}`;

async function callGemini(key, model, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

function cleanList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && (x.sku || x.title))
    .slice(0, 20)
    .map((x) => ({
      sku: String(x.sku || "").slice(0, 40),
      title: String(x.title || "").slice(0, 120),
      variant: String(x.variant || "").slice(0, 120),
      qty: Math.min(50, Math.max(1, parseInt(x.qty, 10) || 1)),
      why: String(x.why || "").slice(0, 200),
    }));
}

async function aiMatch(env, input) {
  const key = (env.GEMINI_API_KEY || "").trim();
  if (!key) return { ok: false, error: "no-key" };
  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const clip = (s, n) => String(s || "").slice(0, n);
  // الكتالوج أولاً (ثابت) ثم بيانات الشحنة — يساعد التخزين المؤقت ويقلل التكلفة
  const text = [
    `الكتالوج (كل سطر: المنتج: SKU=الشكل | ...):\n${clip(input.catalog, 40000)}`,
    `scenario: ${clip(input.scenario, 30)}`,
    `نوع الشحنة في Bosta: ${clip(input.type, 60)}`,
    `وصف الشحنة:\n${clip(input.description, 2000) || "(فارغ)"}`,
    `الملحوظة:\n${clip(input.notes, 2000) || "(فارغة)"}`,
  ].join("\n\n");
  const body = (thinking) => ({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseMimeType: "application/json", ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
  });
  let res;
  try {
    res = await callGemini(key, model, body(true));
    if (res.status === 400) res = await callGemini(key, model, body(false)); // نموذج لا يقبل إعداد التفكير
  } catch (e) {
    return { ok: false, error: "تعذّر الاتصال بـ Gemini: " + String(e) };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: `Gemini ${res.status}: ${data?.error?.message || ""}`.slice(0, 300) };
  const out = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  let j;
  try {
    j = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "رد غير مفهوم من Gemini" };
  }
  return {
    ok: true,
    model,
    expected: cleanList(j.expected),
    kept: cleanList(j.kept),
    unknown: (Array.isArray(j.unknown) ? j.unknown : []).map(String).filter(Boolean).slice(0, 10),
    confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "low",
    message: String(j.message || "").slice(0, 300),
  };
}

// ════════════════ المسارات ════════════════
export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (allowed !== "*" && origin && origin !== allowed) return json({ error: "forbidden" }, 403);

    const url = new URL(req.url);

    // رابط الـ Worker نفسه ليس صفحة: نحوّل من يفتحه إلى الموقع
    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(env.SITE_URL || "https://mymw12803-ui.github.io/khiam-returns/", 302);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, ai: !!(env.GEMINI_API_KEY || "").trim(), model: (env.GEMINI_MODEL || DEFAULT_MODEL).trim(), bostaKeys: [env.BOSTA_API_KEY_1, env.BOSTA_API_KEY_2].filter((k) => (k || "").trim()).length });
    }

    if (url.pathname === "/api/ai" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 80000) return json({ ok: false, error: "طلب كبير جداً" }, 413);
      let input;
      try { input = JSON.parse(raw); } catch { return json({ ok: false, error: "JSON غير صالح" }, 400); }
      return json(await aiMatch(env, input));
    }

    const m = url.pathname.match(/^\/api\/shipment\/(.+)$/);
    if (m) {
      const tn = extractTracking(decodeURIComponent(m[1]));
      if (!tn) return json({ found: false, error: "رقم تتبع غير صالح" }, 400);
      const out = await lookup(env, tn, { debug: url.searchParams.has("debug"), inspect: url.searchParams.has("inspect") });
      return json(out, out.found ? 200 : 404);
    }

    return json({ error: "not found" }, 404);
  },
};
