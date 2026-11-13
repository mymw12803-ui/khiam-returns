// مطابقة وصف الشحنة (من Bosta) مع منتجات متجر khiam.store — تعمل في المتصفح وفي Node
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
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .map((t) => ALIAS[t] || t)
    .filter((t) => !ACTION.has(t));
}

function codeOf(value) {
  const m = String(value).match(/([a-z]\d{1,2})\)?\s*$/i);
  return m ? m[1].toLowerCase() : null;
}
function stripCode(value) {
  return String(value).replace(/\(?\b[a-z]\d{1,2}\b\)?\s*$/i, "").replace(/([^\s])[a-z]\d{1,2}$/i, "$1");
}

// تقسيم النص إلى قطع، كل قطعة تنتهي بـ (QTY n)
export function splitSegments(text) {
  const out = [];
  const t = String(text || "").replace(/\r/g, "\n");
  const re = /\(\s*(?:QTY\s*(\d+)|(\d+)\s*QTY)\s*\)/gi;
  let last = 0, m;
  while ((m = re.exec(t))) {
    out.push({ raw: t.slice(last, m.index).trim(), qty: +(m[1] || m[2]) });
    last = m.index + m[0].length;
  }
  const tail = t.slice(last).trim();
  if (tail) out.push({ raw: tail, qty: null });
  // تقسيم إضافي بالسطر أو علامة +
  return out.flatMap((s) => s.raw.split(/\n+|\s\+\s/).map((r, i, a) => ({ raw: r.trim(), qty: i === a.length - 1 ? s.qty : null })).filter((x) => x.raw));
}

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
  let picks = top > 0 ? scored.filter((s) => s.score === top) : [];
  // نفس المنتج بعدة أشكال متطابقة → نكتفي بأول 6
  picks = picks.slice(0, 6);
  const prods = top > 0 ? [...new Set(picks.map((x) => x.product.id))] : best.map((p) => p.id);
  return {
    raw: seg.raw,
    qty: seg.qty,
    exact: top > 0 && prods.length === 1,
    products: prods.map((id) => best.find((p) => p.id === id)),
    variants: picks.map((x) => ({ product: x.product, variant: x.variant })),
  };
}

export function matchText(text, products) {
  return splitSegments(text).map((seg) => matchSegment(seg, products) || { raw: seg.raw, qty: seg.qty, unmatched: true });
}
