// Cloudflare Worker: وسيط آمن يحمل مفاتيح Bosta كأسرار (Secrets) بعيداً عن الموقع العام
import { lookup, extractTracking } from "./bosta.js";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (allowed !== "*" && origin && origin !== allowed) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: cors });
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/shipment\/(.+)$/);
    if (!m) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cors });
    const tn = extractTracking(decodeURIComponent(m[1]));
    if (!tn) return new Response(JSON.stringify({ error: "رقم تتبع غير صالح" }), { status: 400, headers: cors });
    const out = await lookup(env, tn, { debug: url.searchParams.has("debug") });
    return new Response(JSON.stringify(out), { status: out.found ? 200 : 404, headers: cors });
  },
};
