// Ejecuta el set de 40 consultas de aceptación (documento de alcance v1.2, sección 5) y genera el reporte.
//
//   npm run evaluar        → modo sin IA (solo buscador). No usa internet.
//   npm run evaluar:ia     → con la IA configurada en .env. Espera entre consultas para no pasar el
//                            límite del plan gratuito (≈5 consultas por minuto). Demora unos 10 minutos.
//                            Si se acaba la cuota del día, vuelve a correrlo otro día: retoma donde quedó.
//
// Métricas (metas del alcance):
//   Exactitud     = respuestas con el registro correcto / respuestas entregadas        (meta 100%)
//   Cobertura     = consultas de la base que reciben respuesta / 30                     (meta ≥ 80%)
//   Sin invención = consultas fuera de la base que NO reciben respuesta / 10            (meta 10 de 10)

const fs = require("fs");
const path = require("path");
const { cargarEnv } = require("../server");
const { Buscador } = require("../lib/buscador");
const { Repositorio } = require("../lib/repositorio");
const { Asistente } = require("../lib/asistente");
const { llamarLLM, iaConfigurada } = require("../lib/llm");

const RAIZ = path.join(__dirname, "..");
const conIA = process.argv.includes("--ia");
const ESPERA_MS = 13000;   // 60 s / 5 consultas por minuto, con margen

async function main() {
  cargarEnv(path.join(RAIZ, ".env"));
  process.env.BASE_URL ||= "https://generativelanguage.googleapis.com/v1beta/openai";
  process.env.MODEL ||= "gemini-2.5-flash";
  if (conIA && !iaConfigurada()) { console.error("No hay API_KEY en .env: no se puede evaluar con IA."); process.exit(1); }

  const repositorio = new Repositorio(path.join(RAIZ, "data/faqs.json"));
  const buscador = new Buscador(repositorio.listar());
  let llamadas = 0;
  const llm = conIA ? async (m) => { if (llamadas++) await new Promise((r) => setTimeout(r, ESPERA_MS)); return llamarLLM(m); } : null;
  const asistente = new Asistente({ buscador, repositorio, llamarLLM: llm });

  const { consultas } = JSON.parse(fs.readFileSync(path.join(RAIZ, "pruebas/set_aceptacion.json"), "utf8"));
  // Con IA, los resultados se guardan a medida que avanza: si se acaba la cuota diaria o Gemini está
  // saturado, al volver a correrlo se retoman solo las consultas que no alcanzó a responder la IA.
  const rutaParcial = path.join(RAIZ, "pruebas/resultados_parciales_con_ia.json");
  const parciales = conIA && fs.existsSync(rutaParcial) ? JSON.parse(fs.readFileSync(rutaParcial, "utf8")) : {};
  const filas = [];
  for (const c of consultas) {
    const previo = parciales[c.n];
    if (previo && previo.consulta === c.consulta) { filas.push(previo); process.stdout.write("·"); continue; }
    const r = await asistente.responder(c.consulta);
    const respondio = r.tipo === "respuesta";
    const id = respondio ? r.faqs[0].id : null;
    const enBase = Array.isArray(c.esperados);
    const correcto = enBase ? respondio && c.esperados.includes(id) : !respondio;
    let resultado;
    if (enBase) resultado = !respondio ? "Sin respuesta (deriva)" : correcto ? "Correcta" : "Registro equivocado";
    else resultado = respondio ? "Respondió algo que no está en la base" : "Correcto: dice que no sabe y deriva";
    const fila = { ...c, respondio, id, correcto, resultado, fuente: r.fuente || "-" };
    filas.push(fila);
    if (conIA && fila.fuente.startsWith("ia")) {            // solo se guarda si de verdad respondió la IA
      parciales[c.n] = fila;
      fs.writeFileSync(rutaParcial, JSON.stringify(parciales, null, 1));
    }
    process.stdout.write(correcto ? "✓" : "✗");
  }
  console.log();

  const base = filas.filter((f) => Array.isArray(f.esperados));
  const fuera = filas.filter((f) => !Array.isArray(f.esperados));
  const entregadas = filas.filter((f) => f.respondio);
  const correctas = entregadas.filter((f) => Array.isArray(f.esperados) && f.esperados.includes(f.id));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const m = {
    exactitud: pct(correctas.length, entregadas.length),
    cobertura: pct(base.filter((f) => f.respondio).length, base.length),
    sinInvencion: fuera.filter((f) => !f.respondio).length,
  };
  const cumple = (ok) => (ok ? "✅ Cumple" : "❌ No cumple");
  const modo = conIA ? `Con IA (${process.env.MODEL}${process.env.MODEL_RESPALDO ? `, respaldo ${process.env.MODEL_RESPALDO}` : ""})` : "Sin IA (solo buscador)";

  const md = [
    `# Reporte de pruebas de aceptación — ${modo}`,
    "",
    `Fecha: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })} · Base: ${repositorio.listar().length} preguntas · Set: ${consultas.length} consultas (${base.length} de la base, ${fuera.length} fuera de la base)`,
    "",
    "| Métrica | Meta (alcance) | Resultado | Estado |",
    "|---|---|---|---|",
    `| Exactitud | 100% de las respuestas entregadas corresponde al registro correcto | ${m.exactitud}% (${correctas.length} de ${entregadas.length}) | ${cumple(m.exactitud === 100)} |`,
    `| Cobertura | ≥ 80% de las consultas de la base recibe respuesta | ${m.cobertura}% (${base.filter((f) => f.respondio).length} de ${base.length}) | ${cumple(m.cobertura >= 80)} |`,
    `| Sin invención | 0 respuestas en las ${fuera.length} consultas fuera de la base | ${fuera.length - m.sinInvencion} respuestas (${m.sinInvencion} de ${fuera.length} derivadas) | ${cumple(m.sinInvencion === fuera.length)} |`,
    "",
    "## Detalle",
    "",
    "| N° | HU | Consulta | Registro(s) esperado(s) | Registro entregado | Fuente | Resultado |",
    "|---|---|---|---|---|---|---|",
    ...filas.map((f) => `| ${f.n} | ${f.hu} | ${f.consulta} | ${f.esperados ? f.esperados.join(", ") : "— (fuera de la base)"} | ${f.id ?? "—"} | ${f.fuente} | ${f.correcto ? "✅" : "❌"} ${f.resultado} |`),
    "",
  ].join("\n");

  const archivo = path.join(RAIZ, `pruebas/reporte_aceptacion_${conIA ? "con_ia" : "sin_ia"}.md`);
  fs.writeFileSync(archivo, md);
  console.log(`Exactitud ${m.exactitud}% · Cobertura ${m.cobertura}% · Sin invención ${m.sinInvencion}/${fuera.length}`);
  const sinIA = filas.filter((f) => !String(f.fuente).startsWith("ia")).length;
  if (conIA && sinIA) console.log(`⚠  ${sinIA} consultas no las respondió la IA (saturada o sin cuota). Vuelve a correr "npm run evaluar:ia" más tarde: solo se repiten esas.`);
  if (conIA && !sinIA) console.log("✅ Todas las consultas las respondió la IA. Para empezar de cero, borra pruebas/resultados_parciales_con_ia.json");
  console.log(`Reporte: ${path.relative(RAIZ, archivo)}`);
}

main();
