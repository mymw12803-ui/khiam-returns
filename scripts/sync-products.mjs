// يجلب كل منتجات المتجر (Shopify) ويحفظها في data/products.json
import fs from "node:fs";
const STORE = "https://khiam.store";
const all = [];
for (let page = 1; ; page++) {
  const r = await fetch(`${STORE}/products.json?limit=250&page=${page}`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const { products } = await r.json();
  if (!products.length) break;
  all.push(...products);
}
const slim = all.map((p) => ({
  id: p.id,
  title: p.title,
  url: `${STORE}/products/${p.handle}`,
  image: p.images[0]?.src || "",
  options: p.options.map((o) => ({ name: o.name, values: o.values })),
  variants: p.variants.map((v) => ({
    title: v.title,
    options: [v.option1, v.option2, v.option3].filter(Boolean),
    sku: v.sku || "",
    available: v.available,
    image: v.featured_image?.src || p.images.find((i) => i.variant_ids?.includes(v.id))?.src || "",
  })),
}));
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/products.json", JSON.stringify({ updated: new Date().toISOString(), products: slim }));
console.log(`saved ${slim.length} products`);
