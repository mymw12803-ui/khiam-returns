// تحديد ما يجب استلامه من كل بوليصة Bosta مرتجعة + مطابقته مع منتجات khiam.store
// يعمل في المتصفح (ولا يحتاج أي خادم)

// ───────── تطبيع النص العربي ─────────
export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ً-ٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[^a-z0-9ء-ي]+/g, " ")
    .trim();
}

// كلمات تدل على نوع العملية وليست جزءاً من اسم المنتج
const ACTION = new Set(["استبدال", "استرجاع", "ارجاع", "مرتجع", "رفض", "رفضه", "تبديل", "استبدالات"]);
const ALIAS = { ابدال: "اسدال" }; // خطأ إملائي شائع في الوصف

function tokens(s) {
  return norm(s).split(" ").filter(Boolean).map((t) => ALIAS[t] || t).filter((t) => !ACTION.has(t));
}

function codeOf(value) {
  const m = String(value).match(/([a-z]\d{1,2})\)?\s*$/i);
  return m ? m[1].toLowerCase() : null;
}
function stripCode(value) {
  return String(value).replace(/\(?\b[a-z]\d{1,2}\b\)?\s*$/i, "").replace(/([^\s])[a-z]\d{1,2}$/i, "$1");
}

// ───────── تقسيم النص إلى سطور منتجات، كل سطر قد ينتهي بـ (QTY n) ─────────
export function splitSegments(text) {
  const out = [];
  const t = String(text || "").replace(/\r/g, "\n").replace(/[⁦-⁩‎‏]/g, "");
  const re = /\(\s*(?:QTY\s*(\d+)|(\d+)\s*QTY)\s*\)/gi;
  let last = 0, m;
  while ((m = re.exec(t))) {
    out.push({ raw: t.slice(last, m.index).trim(), qty: +(m[1] || m[2]) });
    last = m.index + m[0].length;
  }
  const tail = t.slice(last).trim();
  if (tail) out.push({ raw: tail, qty: null });
  return out.flatMap((s) => s.raw.split(/\n+|\s\+\s/).map((r, i, a) => ({ raw: r.trim(), qty: i === a.length - 1 ? s.qty : null })).filter((x) => x.raw));
}

// ───────── مطابقة سطر نصي مع المنتجات (بالاسم + اللون/المقاس) ─────────
export function matchSegment(seg, products) {
  const segTokens = tokens(seg.raw);
  const S = new Set(segTokens);
  const segCodes = new Set((seg.raw.match(/\b[a-z]\d{1,2}\b/gi) || []).map((c) => c.toLowerCase()).filter((c) => c !== "qty"));
  if (!segTokens.length) return null;

  // 1) المنتج: نسبة كلمات العنوان الموجودة في النص ثم عدد الكلمات المطابقة
  let best = [], bestKey = [0, 0];
  for (const p of products) {
    const T = [...new Set(tokens(p.title))];
    if (!T.length) continue;
    const hit = T.filter((t) => S.has(t)).length;
    const key = [hit / T.length, hit];
    const cmp = key[0] - bestKey[0] || key[1] - bestKey[1];
    if (cmp > 0) { best = [p]; bestKey = key; } else if (cmp === 0) best.push(p);
  }
  if (!best.length || bestKey[0] < 0.6 || bestKey[1] < 2) return null;

  // 2) الشكل (اللون/المقاس/الكود) عبر كل المنتجات المرشحة
  const scored = [];
  for (const p of best) {
    for (const v of p.variants) {
      let score = 0;
      for (const val of v.options) {
        const c = codeOf(val);
        if (c && segCodes.has(c)) { score += 10; continue; }
        const vt = tokens(stripCode(val));
        if (vt.length && vt.every((t) => S.has(t))) score += 2;
      }
      scored.push({ product: p, variant: v, score });
    }
  }
  const top = Math.max(0, ...scored.map((s) => s.score));
  const picks = (top > 0 ? scored.filter((s) => s.score === top) : []).slice(0, 6);
  const prods = top > 0 ? [...new Set(picks.map((x) => x.product.id))] : best.map((p) => p.id);
  const exact = top > 0 && picks.length === 1;
  return {
    exact,
    product: exact ? picks[0].product : null,
    variant: exact ? picks[0].variant : null,
    candidates: picks.length ? picks.map((x) => ({ product: x.product, variant: x.variant })) : prods.map((id) => ({ product: best.find((p) => p.id === id), variant: null })),
  };
}

// ───────── أكواد SKU ─────────
export function skuIndex(products) {
  const m = new Map();
  for (const p of products) for (const v of p.variants) if (v.sku) m.set(v.sku.trim().toLowerCase(), { product: p, variant: v });
  return m;
}

export function findSkus(text, index) {
  const out = [];
  const re = /[A-Za-z][A-Za-z0-9]{3,15}/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const hit = index.get(m[0].toLowerCase());
    if (hit) out.push({ sku: m[0], ...hit });
  }
  return out;
}

// منتج من الكتالوج عبر SKU أو (اسم المنتج + اسم الشكل) — يُستخدم لنتيجة الذكاء الاصطناعي
export function resolveRef(ref, products, index) {
  if (ref.sku) {
    const hit = index.get(String(ref.sku).trim().toLowerCase());
    if (hit) return hit;
  }
  if (ref.title) {
    const p = products.find((x) => norm(x.title) === norm(ref.title));
    if (p) {
      const v = p.variants.find((x) => norm(x.title) === norm(ref.variant)) || (p.variants.length === 1 ? p.variants[0] : null);
      if (v) return { product: p, variant: v };
    }
  }
  return null;
}

let seq = 0;
function makeItem(source, raw, qty, fields) {
  return { key: `${source}-${++seq}`, source, raw, qty: qty || 1, exact: false, product: null, variant: null, candidates: [], unmatched: false, ...fields };
}

// يحوّل نصاً (وصف أو ملحوظة) إلى قائمة منتجات
// strict=true للملاحظات: السطور التي لا تطابق منتجاً تُعتبر سبباً/كلاماً وليست منتجاً
export function itemsFromText(text, products, index, source, { strict = false } = {}) {
  const items = [];
  const leftovers = [];
  for (const seg of splitSegments(text)) {
    const skus = findSkus(seg.raw, index);
    if (skus.length) {
      for (const s of skus) items.push(makeItem(source, seg.raw, seg.qty, { exact: true, product: s.product, variant: s.variant, sku: s.variant.sku }));
      continue;
    }
    const m = matchSegment(seg, products);
    if (m) items.push(makeItem(source, seg.raw, seg.qty, { ...m, sku: m.variant?.sku || "" }));
    else if (strict) leftovers.push(seg.raw);
    else items.push(makeItem(source, seg.raw, seg.qty, { unmatched: true }));
  }
  return { items, leftovers };
}

// ───────── السيناريو: ماذا يعني هذا المرتجع؟ ─────────
export const SCENARIOS = {
  rto: { title: "أوردر مرفوض – رجع للمخزن", hint: "استلم كل المنتجات المكتوبة في وصف الشحنة.", cls: "rt" },
  exchange: { title: "استبدال – استلم المنتج القديم", hint: "المنتجات الجديدة (في وصف الشحنة) بقيت مع العميل. المرتجع هو المكتوب في الملحوظة.", cls: "ex" },
  exchangeRefused: { title: "استبدال مرفوض (RTO) – رجع المنتج الجديد", hint: "العميل رفض الاستبدال: استلم ما في وصف الشحنة، والمنتج القديم بقي معه.", cls: "rt" },
  return: { title: "استرجاع من العميل", hint: "استلم المنتجات المكتوبة في وصف الشحنة.", cls: "rt" },
  cash: { title: "تحصيل نقدي", hint: "لا توجد منتجات في هذا النوع.", cls: "" },
};

export function scenarioOf(delivery, { exchangeRefused = false } = {}) {
  const t = norm(delivery.type).replace(/ /g, "_");
  if (t.includes("exchange")) return exchangeRefused ? "exchangeRefused" : "exchange";
  if (t.includes("customer_return") || t.includes("return_pickup")) return "return";
  if (t.includes("cash")) return "cash";
  return "rto"; // Return to Origin / SEND / غير معروف: الطرد كله يرجع
}

// النتيجة: expected = ما يجب استلامه، kept = ما بقي مع العميل (للعلم فقط)
export function analyze(delivery, products, index, opts = {}) {
  const scenario = scenarioOf(delivery, opts);
  const desc = itemsFromText(delivery.description, products, index, "description");
  let expected = [], kept = [], reason = "";
  if (scenario === "exchange" || scenario === "exchangeRefused") {
    const notes = itemsFromText(delivery.notes, products, index, "notes", { strict: true });
    reason = notes.leftovers.join(" – ");
    if (scenario === "exchange") { expected = notes.items; kept = desc.items; }
    else { expected = desc.items; kept = notes.items; }
  } else if (scenario !== "cash") {
    expected = desc.items;
  }
  const needsAI = scenario !== "cash" && (!expected.length || expected.some((i) => !i.exact));
  return { scenario, ...SCENARIOS[scenario], expected, kept, reason, needsAI };
}

// كتالوج مختصر يُرسل للذكاء الاصطناعي
export function compactCatalog(products) {
  return products.map((p) => `${p.title}: ` + p.variants.map((v) => `${v.sku || "-"}=${v.title}`).join(" | ")).join("\n");
}
