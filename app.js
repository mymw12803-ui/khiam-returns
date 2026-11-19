import { analyze, skuIndex, resolveRef, compactCatalog } from "./match.js";

const $ = (id) => document.getElementById(id);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const API = isLocal ? "" : (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");
const TYPE_AR = {
  Exchange: "استبدال", EXCHANGE: "استبدال",
  "Return to Origin": "مرتجع للتاجر (RTO)",
  "Customer Return Pickup": "استرجاع من العميل", CUSTOMER_RETURN_PICKUP: "استرجاع من العميل",
  SEND: "توصيل", Deliver: "توصيل", CASH_COLLECTION: "تحصيل نقدي", "Cash Collection": "تحصيل نقدي",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const img = (u) => (u ? `<img src="${esc(u)}${u.includes("?") ? "&" : "?"}width=400" alt="" loading="lazy">` : `<div class="noimg">؟</div>`);
const setStatus = (text, cls = "") => { const st = $("status"); st.className = cls; st.textContent = text; };

// ───────── المنتجات ─────────
let products = [], index = new Map(), catalog = "";
const ready = fetch("data/products.json").then((r) => r.json()).then((d) => {
  products = d.products;
  index = skuIndex(products);
  catalog = compactCatalog(products);
  $("meta").textContent = `${products.length} منتج • تحديث ${d.updated.slice(0, 10)}`;
});
let aiReady = null;
fetch(`${API}/api/health`).then((r) => r.json()).then((h) => { aiReady = !!h.ai; }).catch(() => { aiReady = false; })
  .finally(() => ready.then(() => { $("meta").textContent += aiReady ? " • 🤖 الذكاء الاصطناعي مفعّل" : " • الذكاء الاصطناعي غير مفعّل"; }));

// ───────── الشحنة الحالية ─────────
// current = { delivery, account, refused, view, received:{id:qty}, ai:{[scenario]:{status,result}} }
let current = null;
const itemId = (i) => i.sku || i.raw;

// يحسب ما يجب استلامه (قواعد + ذكاء اصطناعي + اختيارات الموظف اليدوية)
function computeView() {
  const base = analyze(current.delivery, products, index, { exchangeRefused: current.refused });
  const ai = current.ai[base.scenario];
  let view = base;
  if (base.needsAI && ai?.status === "done") view = applyAI(base, ai.result);
  else if (base.needsAI && !ai && aiReady !== false) askAI(base.scenario);
  for (const it of view.expected) {
    const pick = current.picks[it.raw];
    const c = !it.exact && pick && it.candidates.find((x) => x.variant && (x.variant.sku || x.variant.title) === pick);
    if (c) Object.assign(it, { exact: true, product: c.product, variant: c.variant, sku: c.variant.sku || "" });
  }
  return view;
}
function refresh() { if (current) current.view = computeView(); paint(); }

let aiSeq = 0;
function fromAI(list, source) {
  return list.map((r) => {
    const hit = resolveRef(r, products, index);
    const k = `ai-${++aiSeq}`;
    return hit
      ? { key: k, source, raw: r.why || "", qty: r.qty, exact: true, product: hit.product, variant: hit.variant, sku: hit.variant.sku || "", candidates: [], ai: true }
      : { key: k, source, raw: [r.title, r.variant, r.sku].filter(Boolean).join(" – "), qty: r.qty, unmatched: true, candidates: [], ai: true };
  });
}
function applyAI(base, res) {
  const expected = [...fromAI(res.expected, "ai"), ...res.unknown.map((u) => ({ key: `ai-${++aiSeq}`, source: "ai", raw: u, qty: 1, unmatched: true, candidates: [] }))];
  if (!expected.length) return { ...base, aiNote: res.message || "الذكاء الاصطناعي لم يحدد منتجات" };
  return { ...base, expected, kept: res.kept.length ? fromAI(res.kept, "ai") : base.kept, aiUsed: true, aiNote: res.message, aiConfidence: res.confidence };
}

async function askAI(scenario) {
  const cur = current;
  cur.ai[scenario] = { status: "loading" };
  const call = async () => (await fetch(`${API}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, type: cur.delivery.type, description: cur.delivery.description, notes: cur.delivery.notes, catalog }),
  })).json();
  try {
    let j = await call();
    // ضغط مؤقت على Gemini (503/429): نعيد المحاولة تلقائياً مرتين
    for (let n = 0; n < 2 && !j.ok && /Gemini (503|429|500)/.test(j.error || ""); n++) {
      await new Promise((ok) => setTimeout(ok, 1200 * (n + 1)));
      j = await call();
    }
    cur.ai[scenario] = j.ok ? { status: "done", result: j } : { status: "error", error: j.error === "no-key" ? "مفتاح Gemini غير مضبوط في الـ Worker" : j.error };
  } catch (e) {
    cur.ai[scenario] = { status: "error", error: "الذكاء الاصطناعي غير متاح" };
  }
  if (current === cur) refresh();
}

// ───────── العرض ─────────
function itemCard(i, mode) {
  const p = i.product, v = i.variant;
  const rec = current.received[itemId(i)] ?? 0;
  const done = rec === i.qty ? " done" : rec > i.qty ? " over" : "";
  let body;
  if (i.unmatched) {
    body = `<h3 class="warn">⚠ لم أتعرف على المنتج</h3><div class="rawtext">${esc(i.raw)}</div>`;
  } else if (!i.exact) {
    const c = i.candidates;
    body = `<h3>${esc(c[0]?.product.title || "")}</h3>
      <div class="warn">اختر الشكل الصحيح (${c.length} احتمالات):</div>
      <div class="cands">${c.map((x, n) => `<button type="button" class="cand" data-act="pick" data-key="${esc(i.key)}" data-n="${n}">${img(x.variant?.image || x.product.image)}<span>${esc(x.variant?.title || x.product.title)}</span></button>`).join("")}</div>
      <div class="rawtext">${esc(i.raw)}</div>`;
  } else {
    body = `<h3><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div>${(v?.options || []).map((o) => `<span class="opt">${esc(o)}</span>`).join("")}${i.sku ? `<code class="sku">${esc(i.sku)}</code>` : ""}${i.ai ? `<span class="badge ai">🤖</span>` : ""}</div>
      ${i.raw ? `<div class="rawtext">${esc(i.raw)}</div>` : ""}`;
  }
  const pic = i.exact ? img(v?.image || p?.image) : i.unmatched ? `<div class="noimg">؟</div>` : "";
  if (mode === "kept") return `<div class="item kept">${pic ? `<div class="imgs">${pic}</div>` : ""}<div class="info">${body}<div class="raw">× ${i.qty}</div></div></div>`;
  return `<div class="item${done}" data-id="${esc(itemId(i))}">
    ${pic ? `<div class="imgs">${pic}</div>` : ""}
    <div class="info">${body}
      <div class="qtyrow">
        <span>المطلوب <b class="big">${i.qty}</b></span>
        <span class="step">المستلم
          <button type="button" class="alt sm" data-act="dec" data-id="${esc(itemId(i))}">−</button>
          <b class="big">${rec}</b>
          <button type="button" class="alt sm" data-act="inc" data-id="${esc(itemId(i))}">+</button>
        </span>
        <button type="button" class="sm ok" data-act="all" data-id="${esc(itemId(i))}" data-qty="${i.qty}">✓ استلمت</button>
      </div>
    </div>
  </div>`;
}

function paint() {
  if (!current) { $("result").innerHTML = ""; return; }
  const d = current.delivery;
  const view = current.view;
  const ai = current.ai[view.scenario];
  const isEx = view.scenario === "exchange" || view.scenario === "exchangeRefused";
  const total = view.expected.reduce((s, i) => s + i.qty, 0);
  const got = view.expected.reduce((s, i) => s + (current.received[itemId(i)] ?? 0), 0);
  let aiLine = "";
  if (ai?.status === "loading") aiLine = `<div class="ailine">🤖 الذكاء الاصطناعي يحلل البوليصة…</div>`;
  else if (ai?.status === "error") aiLine = `<div class="ailine err">🤖 ${/Gemini (503|429|500)/.test(ai.error) ? "Gemini مشغول حالياً" : esc(ai.error)} — راجع النص بنفسك أو <button type="button" class="sm alt" data-act="retryai">🔄 أعد المحاولة</button></div>`;
  else if (view.aiUsed || view.aiNote) {
    const unsure = view.aiConfidence !== "high";
    aiLine = `<div class="ailine ${unsure ? "err" : ""}">🤖 ${esc(view.aiNote || "")}${unsure ? " — ⚠ الذكاء الاصطناعي غير متأكد: افتح الطرد وقارن بنص البوليصة" : ""}</div>`;
  }
  else if (view.needsAI && aiReady === false) aiLine = `<div class="ailine err">لم أستطع تحديد كل المنتجات تلقائياً، والذكاء الاصطناعي غير مفعّل — راجع نص البوليصة بالأسفل.</div>`;
  const showText = view.needsAI && (!view.aiUsed || view.aiConfidence !== "high");

  $("result").innerHTML = `<article class="ship">
    <div class="head"><b class="tn">${esc(d.trackingNumber)}</b>
      ${d.type ? `<span class="badge">${esc(TYPE_AR[d.type] || d.type)}</span>` : ""}
      ${d.state ? `<span class="badge">${esc(d.state)}</span>` : ""}
      ${d.businessReference ? `<span class="raw">${esc(d.businessReference)}</span>` : ""}
      ${d.receiverName ? `<span class="raw">• ${esc(d.receiverName)}</span>` : ""}</div>
    ${current.dup ? `<div class="dup">⚠ هذه الشحنة مسجلة من قبل في السجل (${esc(current.dup)})</div>` : ""}
    <div class="scen ${view.cls}"><b>${esc(view.title)}</b><div>${esc(view.hint)}</div>${view.reason ? `<div class="reason">سبب الاستبدال: ${esc(view.reason)}</div>` : ""}</div>
    ${isEx ? `<label class="toggle"><input type="checkbox" id="refused" ${current.refused ? "checked" : ""}> الطرد عليه ملصق <b>RTO</b> أحمر (العميل رفض الاستبدال)</label>` : ""}
    ${aiLine}
    ${view.expected.length ? `<h3 class="sec">✅ المطلوب استلامه (${total} قطعة)</h3>${view.expected.map((i) => itemCard(i, "exp")).join("")}`
      : view.scenario === "cash" ? "" : `<div class="warn">لم أجد منتجات في البوليصة — راجع النص بالأسفل.</div>`}
    ${view.kept.length ? `<details class="keptbox"><summary>بقي مع العميل — لا تنتظره (${view.kept.length})</summary>${view.kept.map((i) => itemCard(i, "kept")).join("")}</details>` : ""}
    <details class="texts"${showText ? " open" : ""}><summary>نص البوليصة</summary>
      <div><b>وصف الشحنة:</b> ${esc(d.description) || "—"}</div>
      <div><b>الملحوظة:</b> ${esc(d.notes) || "—"}</div></details>
    <textarea id="extra" rows="2" placeholder="منتج زيادة وجدته في الطرد أو ملاحظة (اختياري)">${esc(current.extra || "")}</textarea>
    <div class="verify-bar"><span>المستلم <b>${got}</b> من <b>${total}</b></span>
      <button type="button" id="verify" class="${got === total && total ? "" : "warnbtn"}">✅ تم التحقق</button></div>
  </article>`;
}

$("result").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || !current) return;
  const id = b.dataset.id;
  const r = current.received;
  if (b.dataset.act === "inc") r[id] = (r[id] ?? 0) + 1;
  else if (b.dataset.act === "dec") r[id] = Math.max(0, (r[id] ?? 0) - 1);
  else if (b.dataset.act === "all") r[id] = +b.dataset.qty;
  else if (b.dataset.act === "retryai") { delete current.ai[current.view.scenario]; refresh(); return; }
  else if (b.dataset.act === "pick") {
    const it = current.view.expected.find((x) => x.key === b.dataset.key);
    const c = it?.candidates[+b.dataset.n];
    if (c?.variant) {
      current.picks[it.raw] = c.variant.sku || c.variant.title;
      Object.assign(it, { exact: true, product: c.product, variant: c.variant, sku: c.variant.sku || "" });
    }
  }
  paint();
});
$("result").addEventListener("change", (e) => {
  if (e.target.id === "refused") { current.refused = e.target.checked; current.received = {}; refresh(); }
});
$("result").addEventListener("input", (e) => { if (e.target.id === "extra" && current) current.extra = e.target.value; });
$("result").addEventListener("click", (e) => { if (e.target.id === "verify") verify(); });

// ───────── البحث ─────────
async function search(raw) {
  const runs = String(raw).match(/\d{6,}/g);
  const tn = runs && runs.sort((a, b) => b.length - a.length)[0];
  if (!tn) { setStatus("لم أستطع قراءة رقم تتبع صالح", "err"); return; }
  if (!API && !isLocal) { setStatus("لم يتم ربط الموقع بالخادم: ضع رابط الـ Worker في config.js (API_BASE). البحث اليدوي يعمل بدونه.", "err"); return; }
  const pending = current && !current.verified && Object.values(current.received).some((x) => x > 0) ? current.delivery.trackingNumber : null;
  setStatus("جارٍ البحث عن " + tn + " …");
  try {
    const res = await fetch(`${API}/api/shipment/${tn}`);
    const data = await res.json().catch(() => ({ found: false }));
    if (!data.found) { setStatus(data.error || (data.configuredKeys === 0 ? "لم يتم ضبط مفاتيح Bosta" : `الشحنة ${tn} غير موجودة في حسابي Bosta`), "err"); return; }
    await ready;
    open(data.delivery);
    setStatus(`تم (حساب ${data.account})` + (pending ? ` — تنبيه: الشحنة السابقة ${pending} لم تُسجَّل` : ""), pending ? "err" : "");
    navigator.vibrate?.(60);
  } catch (e) {
    setStatus("تعذّر الاتصال بالخادم: " + e.message, "err");
  }
}

function open(delivery) {
  const prev = log.find((r) => r.tn === delivery.trackingNumber && delivery.trackingNumber !== "يدوي");
  current = { delivery, refused: false, received: {}, ai: {}, picks: {}, extra: "", dup: prev ? new Date(prev.time).toLocaleString("ar-EG") : "" };
  refresh();
}

$("form").onsubmit = (e) => { e.preventDefault(); search($("tn").value); };
$("go").onclick = async () => {
  await ready;
  setStatus("");
  open({ trackingNumber: "يدوي", type: $("m-type").value, description: $("m-desc").value, notes: $("m-notes").value });
};

// ───────── التحقق والسجل ─────────
const LOG_KEY = "khiam-returns-log";
let log = [];
try { log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { log = []; }
const saveLog = () => { try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {} };

function verify() {
  const v = current.view;
  const items = v.expected.map((i) => {
    const got = current.received[itemId(i)] ?? 0;
    return {
      name: i.exact || i.candidates?.length ? (i.product || i.candidates[0].product).title : i.raw,
      variant: i.exact ? i.variant?.title || "" : "(لم يُحدد)",
      sku: i.exact ? i.sku || "" : "",
      expected: i.qty,
      received: got,
      status: got === i.qty ? "مطابق" : got < i.qty ? (got === 0 ? "لم يصل" : "ناقص") : "زيادة",
    };
  });
  const extra = ($("extra")?.value || "").trim();
  const allOk = items.length && items.every((x) => x.status === "مطابق");
  const status = allOk && !extra ? "مطابق ✅" : items.some((x) => x.status !== "مطابق" && x.status !== "زيادة") ? "ناقص ⚠" : "به ملاحظة";
  const d = current.delivery;
  log.unshift({ time: new Date().toISOString(), tn: d.trackingNumber, ref: d.businessReference || "", type: TYPE_AR[d.type] || d.type || "", scenario: v.title, ai: !!v.aiUsed, items, extra, status });
  saveLog();
  drawLog();
  current.verified = true;
  setStatus(`✅ تم تسجيل ${d.trackingNumber} — ${status}. امسح البوليصة التالية.`);
  current = null;
  paint();
  if (!touch) $("tn").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  afterVerify();
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB");

function drawLog() {
  $("log-wrap").hidden = !log.length;
  const pieces = log.reduce((s, r) => s + r.items.reduce((a, i) => a + i.received, 0), 0);
  $("log-count").textContent = `(${log.length} شحنة • ${pieces} قطعة)`;
  $("log").innerHTML = `<thead><tr><th>الوقت</th><th>رقم التتبع</th><th>النوع</th><th>المنتج</th><th>الشكل</th><th>SKU</th><th>المطلوب</th><th>المستلم</th><th>الحالة</th><th></th></tr></thead>` +
    log.map((r, n) => {
      const rows = r.items.length ? r.items : [{ name: "—", variant: "", sku: "", expected: 0, received: 0, status: "" }];
      return `<tbody class="${r.status.startsWith("مطابق") ? "" : "bad"}">` + rows.map((i, k) => `<tr>
        ${k === 0 ? `<td rowspan="${rows.length}">${fmtTime(r.time)}</td><td rowspan="${rows.length}"><b>${esc(r.tn)}</b><div class="raw">${esc(r.ref)}</div></td><td rowspan="${rows.length}">${esc(r.scenario)}${r.ai ? " 🤖" : ""}${r.extra ? `<div class="raw">📝 ${esc(r.extra)}</div>` : ""}</td>` : ""}
        <td>${esc(i.name)}</td><td>${esc(i.variant)}</td><td><code>${esc(i.sku)}</code></td><td>${i.expected}</td><td>${i.received}</td><td class="st">${esc(i.status)}</td>
        ${k === 0 ? `<td rowspan="${rows.length}"><button type="button" class="alt sm" data-del="${n}" title="حذف">✕</button></td>` : ""}</tr>`).join("") + `</tbody>`;
    }).join("");
}
$("log").addEventListener("click", (e) => {
  const n = e.target.dataset?.del;
  if (n === undefined) return;
  if (!confirm(`حذف الشحنة ${log[+n].tn} من السجل؟`)) return;
  log.splice(+n, 1); saveLog(); drawLog();
});
drawLog();

function reportText() {
  const lines = [`📦 تقرير استلام المرتجعات — ${fmtDate(new Date().toISOString())}`, `${log.length} شحنة`, ""];
  [...log].reverse().forEach((r, n) => {
    lines.push(`${n + 1}) ${r.tn}${r.ref ? " – " + r.ref : ""} – ${r.scenario} – ${r.status}`);
    for (const i of r.items) lines.push(`   • ${i.name}${i.variant ? " – " + i.variant : ""}${i.sku ? ` [${i.sku}]` : ""}: المطلوب ${i.expected} / المستلم ${i.received} (${i.status})`);
    if (r.extra) lines.push(`   📝 ${r.extra}`);
  });
  return lines.join("\n");
}
$("copy").onclick = async () => {
  const t = reportText();
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  setStatus("📋 تم نسخ التقرير");
};
$("xlsx").onclick = () => {
  const rows = [...log].reverse().flatMap((r) => (r.items.length ? r.items : [{}]).map((i) => ({
    "التاريخ": fmtDate(r.time), "الوقت": fmtTime(r.time), "رقم التتبع": r.tn, "رقم الطلب": r.ref, "نوع المرتجع": r.scenario,
    "المنتج": i.name || "", "اللون/المقاس": i.variant || "", "SKU": i.sku || "", "المطلوب": i.expected ?? "", "المستلم": i.received ?? "",
    "حالة المنتج": i.status || "", "حالة الشحنة": r.status, "ملاحظة": r.extra || "", "بمساعدة AI": r.ai ? "نعم" : "",
  })));
  const name = `مرتجعات-خيام-${new Date().toISOString().slice(0, 10)}`;
  if (window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: k === "المنتج" ? 28 : k === "ملاحظة" ? 24 : 14 }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "المرتجعات");
    XLSX.writeFile(wb, name + ".xlsx");
  } else {
    const head = Object.keys(rows[0] || {});
    const csv = [head, ...rows.map((r) => head.map((h) => r[h]))].map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: name + ".csv" });
    a.click();
  }
};
$("clear").onclick = () => {
  if (!log.length || !confirm("مسح السجل بالكامل؟ نزّل ملف Excel أولاً إن كنت تحتاجه.")) return;
  log = []; saveLog(); drawLog();
};

// ───────── الكاميرا (الهاتف) ─────────
// يقرأ باركود البوليصة أو الـ QR، يغلق الكاميرا ويعرض المطلوب استلامه.
// بعد «تم التحقق» تُفتح الكاميرا تلقائياً للبوليصة التالية (وضع المسح المتتابع).
let scanner = null, camMode = false;
async function stopCam() {
  if (scanner) await scanner.stop().catch(() => {});
  scanner = null;
  $("reader").hidden = true;
  $("cam").textContent = "📷 كاميرا";
}
async function startCam() {
  const box = $("reader");
  box.hidden = false;
  $("cam").textContent = "✕ إغلاق الكاميرا";
  const F = window.Html5QrcodeSupportedFormats;
  scanner = new Html5Qrcode("reader", {
    verbose: false,
    formatsToSupport: F ? [F.CODE_128, F.QR_CODE, F.CODE_39, F.EAN_13, F.ITF] : undefined,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  });
  let done = false;
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.92, 460)), height: Math.floor(Math.min(h * 0.45, 200)) }) },
      async (text) => {
        if (done || !/\d{6,}/.test(text)) return; // تجاهل أي كود لا يحتوي رقم تتبع
        done = true;
        navigator.vibrate?.(80);
        await stopCam();
        search(text);
      },
    );
  } catch (e) {
    await stopCam();
    camMode = false;
    setStatus("تعذّر تشغيل الكاميرا: اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح. (" + e + ")", "err");
  }
}
$("cam").onclick = async () => {
  if (scanner) { camMode = false; await stopCam(); return; }
  camMode = true;
  startCam();
};
const afterVerify = () => { if (camMode) setTimeout(startCam, 400); };

// ───────── وضع السكانر: أي مسح يُلتقط تلقائياً ويبحث فوراً ─────────
const tnInput = $("tn");
let idle;
// على الهاتف لا نُظهر لوحة المفاتيح تلقائياً (المسح يكون بالكاميرا)
const touch = matchMedia("(pointer: coarse)").matches;
const typing = () => /^(TEXTAREA|SELECT|SUMMARY)$/.test(document.activeElement?.tagName || "");
const focusScan = () => { if (!touch && !typing()) tnInput.focus(); };
if (touch) tnInput.removeAttribute("autofocus");
focusScan();
document.addEventListener("click", () => setTimeout(focusScan, 0));
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || (e.key.length > 1 && e.key !== "Enter")) return;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) tnInput.focus();
});
// السكانر الذي لا يرسل Enter: نبحث بعد توقف الإدخال لحظة قصيرة
tnInput.addEventListener("input", () => {
  clearTimeout(idle);
  if (/\d{7,}/.test(tnInput.value)) idle = setTimeout(() => $("form").requestSubmit(), 250);
});
$("form").addEventListener("submit", () => { clearTimeout(idle); setTimeout(() => { tnInput.value = ""; if (touch) tnInput.blur(); else tnInput.focus(); }, 50); });
document.body.classList.toggle("touch", touch);
