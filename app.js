import { matchText } from "./match.js";

const $ = (id) => document.getElementById(id);
const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");
const TYPES = {
  CUSTOMER_RETURN_PICKUP: ["رجوع من العميل", "rt"],
  EXCHANGE: ["استبدال", "ex"],
  "Return to Origin": ["مرتجع للتاجر", "rt"],
  "Customer Return Pickup": ["رجوع من العميل", "rt"],
  Exchange: ["استبدال", "ex"],
  SEND: ["شحنة عادية (مرفوضة؟)", ""],
  CASH_COLLECTION: ["تحصيل نقدي", ""],
};

let products = [];
fetch("data/products.json").then((r) => r.json()).then((d) => {
  products = d.products;
  $("meta").textContent = `${products.length} منتج • تحديث ${d.updated.slice(0, 10)}`;
});

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const img = (u) => (u ? `<img src="${esc(u)}${u.includes("?") ? "&" : "?"}width=500" alt="">` : "");

function renderItems(text, label) {
  const rows = matchText(text, products);
  if (!rows.length) return "";
  return rows.map((r) => {
    const qty = r.qty ? `<span class="badge qty">× ${r.qty}</span>` : "";
    if (r.unmatched) return `<div class="item"><div class="info"><span class="warn">⚠ لم أجد منتجاً مطابقاً</span> ${qty}<div class="raw">${esc(r.raw)}</div></div></div>`;
    const shown = r.variants.length ? r.variants : r.products.map((p) => ({ product: p, variant: null }));
    const imgs = shown.map((x) => img(x.variant?.image || x.product.image)).join("");
    const p0 = r.products[0];
    const opts = r.exact
      ? r.variants[0].variant.options.map((o) => `<span class="opt">${esc(o)}</span>`).join("")
      : `<div class="warn">${r.variants.length ? `أكثر من شكل محتمل (${r.variants.length}):` : "لم يتحدد اللون/المقاس بدقة"} ${shown.map((x) => esc(x.variant?.title || "")).filter(Boolean).join(" • ")}</div>`;
    const title = r.products.length > 1 ? r.products.map((p) => esc(p.title)).join(" / ") : `<a href="${esc(p0.url)}" target="_blank" rel="noopener">${esc(p0.title)}</a>`;
    return `<div class="item"><div class="imgs">${imgs}</div><div class="info"><h3>${title} ${qty}</h3>${opts}<div class="raw">${label}: ${esc(r.raw)}</div></div></div>`;
  }).join("");
}

function renderShipment(s) {
  const [tname, tcls] = TYPES[s.type] || [s.type || "", ""];
  const fromDesc = renderItems(s.description, "الوصف");
  // الملحوظة: نعرضها دائماً كنص، ونعرض المنتجات التي تطابقت منها فقط
  const fromNotes = s.notes ? renderItems(s.notes, "ملحوظة").split('<div class="item">').filter((x) => x && !x.includes("لم أجد منتجاً")).map((x) => '<div class="item">' + x).join("") : "";
  return `<article class="ship">
    <div class="head"><b>${esc(s.trackingNumber)}</b>${tname ? `<span class="badge ${tcls}">${tname}</span>` : ""}
      ${s.state ? `<span class="badge">${esc(s.state)}</span>` : ""}
      ${s.businessReference ? `<span class="raw">${esc(s.businessReference)}</span>` : ""}
      ${s.receiverName ? `<span class="raw">• ${esc(s.receiverName)}</span>` : ""}</div>
    ${s.notes ? `<div class="notes"><b>الملحوظة:</b> ${esc(s.notes)}</div>` : ""}
    ${fromDesc || '<div class="warn">لا يوجد وصف للشحنة</div>'}
    ${fromNotes}
  </article>`;
}

const hist = JSON.parse(localStorage.getItem("hist") || "[]");
function drawHist() {
  $("hist-wrap").hidden = !hist.length;
  $("hist").innerHTML = hist.map((t) => `<li data-t="${esc(t)}">${esc(t)}</li>`).join("");
}
$("hist").onclick = (e) => { const t = e.target.dataset?.t; if (t) { $("tn").value = t; search(t); } };
drawHist();

async function search(raw) {
  const runs = String(raw).match(/\d{6,}/g);
  const tn = runs && runs.sort((a, b) => b.length - a.length)[0];
  const st = $("status");
  st.className = "";
  if (!tn) { st.className = "err"; st.textContent = "لم أستطع قراءة رقم تتبع صالح"; return; }
  st.textContent = "جارٍ البحث عن " + tn + " …";
  $("result").innerHTML = "";
  try {
    const res = await fetch(`${API}/api/shipment/${tn}`);
    const data = await res.json();
    if (!data.found) {
      st.className = "err";
      st.textContent = data.error || (data.configuredKeys === 0 ? "لم يتم ضبط مفاتيح API (ملف .env)" : "الشحنة غير موجودة في الحسابين أو رفض المفتاح الطلب (جرّب ?debug من الخادم)");
      return;
    }
    st.textContent = `تم (حساب ${data.account})`;
    $("result").innerHTML = renderShipment(data.delivery);
    const i = hist.indexOf(tn); if (i >= 0) hist.splice(i, 1);
    hist.unshift(tn); hist.length = Math.min(hist.length, 15);
    localStorage.setItem("hist", JSON.stringify(hist)); drawHist();
    navigator.vibrate?.(60);
  } catch (e) {
    st.className = "err"; st.textContent = "تعذّر الاتصال بالخادم: " + e.message;
  }
}

$("form").onsubmit = (e) => { e.preventDefault(); search($("tn").value); $("tn").select(); };
$("go").onclick = () => {
  $("status").textContent = "";
  $("result").innerHTML = `<article class="ship">${renderItems($("txt").value, "النص")}</article>`;
};

let scanner = null;
$("cam").onclick = async () => {
  const box = $("reader");
  if (scanner) { await scanner.stop().catch(() => {}); scanner = null; box.hidden = true; return; }
  box.hidden = false;
  scanner = new Html5Qrcode("reader");
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 300, height: 140 } }, async (text) => {
      await scanner.stop().catch(() => {}); scanner = null; box.hidden = true;
      $("tn").value = text; search(text);
    });
  } catch (e) { box.hidden = true; scanner = null; $("status").className = "err"; $("status").textContent = "تعذّر تشغيل الكاميرا: " + e; }
};
