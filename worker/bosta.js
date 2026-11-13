// منطق جلب الشحنة من Bosta — يعمل داخل Node (server.mjs) وداخل Cloudflare Worker
const BASE = "https://app.bosta.co/api/v2";

// عدة صيغ محتملة لنقطة الجلب؛ أول صيغة تنجح يتم تذكّرها
const STRATEGIES = [
  (tn) => ({ method: "POST", url: `${BASE}/deliveries/search`, body: { trackingNumbers: tn, pageId: 1, pageLimit: 5 } }), // ✔ مؤكدة بالتجربة
  (tn) => ({ method: "GET", url: `${BASE}/deliveries/business/${tn}` }),
  (tn) => ({ method: "GET", url: `${BASE}/deliveries/${tn}` }),
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

function normalize(d) {
  const pd = d.specs?.packageDetails || d.packageDetails || {};
  return {
    trackingNumber: String(d.trackingNumber),
    description: pd.description || "",
    itemsCount: pd.itemsCount ?? null,
    notes: d.notes || "",
    businessReference: d.businessReference || "",
    type: d.type?.value || d.type || "",
    state: d.state?.value || d.state?.code || d.state || "",
    receiverName: d.receiver?.fullName || d.receiver?.firstName || "",
    receiverPhone: d.receiver?.phone || "",
    cod: d.cod ?? null,
  };
}

export function extractTracking(text) {
  const runs = String(text || "").match(/\d{6,}/g);
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : null;
}

export async function lookup(env, tn, { debug = false } = {}) {
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
          return { found: true, account: a + 1, delivery: normalize(d), ...(debug ? { attempts } : {}) };
        }
      } catch (e) {
        attempts.push({ account: a + 1, strategy: i, error: String(e) });
      }
    }
  }
  return { found: false, configuredKeys: keys.filter(Boolean).length, attempts };
}
