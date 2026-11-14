// Muestra los modelos de IA que tu API key puede usar (para elegir MODEL y MODEL_RESPALDO en .env).
// Uso: npm run modelos
const path = require("path");
const { cargarEnv } = require("../server");

(async () => {
  cargarEnv(path.join(__dirname, "..", ".env"));
  const base = process.env.BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
  const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env.API_KEY}` } });
  if (!r.ok) { console.error(`Error ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  const ids = (await r.json()).data.map((m) => m.id.replace(/^models\//, "")).filter((id) => /flash/i.test(id)).sort();
  console.log("Modelos Flash disponibles para tu key:\n" + ids.map((id) => "  " + id).join("\n"));
  console.log(`\nEn tu .env: MODEL=${process.env.MODEL} · MODEL_RESPALDO=${process.env.MODEL_RESPALDO}`);
})();
