// خادم محلي للتجربة (يحتاج Node.js 18+): يقدّم الموقع + نفس مسارات الـ Worker (/api/...) باستخدام مفاتيح .env
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2];
  }
} catch {}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const hidden = /^\/(\.env|\.git|server\.mjs|worker|scripts|_sample)/;

// ── Live reload: أي حفظ لملف في المشروع يعيد تحميل الصفحة تلقائياً ──
const clients = new Set();
let timer;
fs.watch(root, { recursive: true }, (_, f) => {
  if (!f || /^(\.git|node_modules|_sample|\.env)/.test(f)) return;
  clearTimeout(timer);
  timer = setTimeout(() => clients.forEach((c) => c.write(`data: ${f}\n\n`)), 80);
});
const liveScript = `<script>new EventSource("/__live").onmessage=()=>location.reload()</script>`;

const readBody = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__live") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write("\n");
    clients.add(res);
    return req.on("close", () => clients.delete(res));
  }
  if (u.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const r = await worker.fetch(new Request("http://localhost" + req.url, { method: req.method, headers: { "Content-Type": "application/json" }, body }), process.env);
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(await r.text());
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (hidden.test(p) || !file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  const type = types[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  if (path.extname(file) === ".html") return res.end(fs.readFileSync(file, "utf8").replace("</body>", liveScript + "</body>"));
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 8799, () => console.log(`http://localhost:${process.env.PORT || 8799}`));
