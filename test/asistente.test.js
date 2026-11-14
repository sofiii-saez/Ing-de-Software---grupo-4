// Pruebas unitarias del asistente, con una IA FALSA (no se usa internet ni la API key).
//   node --test test/asistente.test.js
const test = require("node:test");
const assert = require("node:assert");
const { Asistente, contieneDatosPersonales, verificarRespuesta, leerJSON } = require("../lib/asistente");
const { Buscador } = require("../lib/buscador");
const FAQS = require("../data/faqs.json");

const repositorio = { obtener: (id) => FAQS.find((f) => f.id === id) || null };
const buscador = new Buscador(FAQS);
const faq = (id) => FAQS.find((f) => f.id === id);

/** IA falsa que devuelve siempre el mismo texto y cuenta cuántas veces la llamaron. */
function iaFalsa(respuesta) {
  const ia = async () => { ia.llamadas++; if (respuesta instanceof Error) throw respuesta; return typeof respuesta === "string" ? respuesta : JSON.stringify(respuesta); };
  ia.llamadas = 0;
  return ia;
}
const conIA = (ia) => new Asistente({ buscador, repositorio, llamarLLM: ia });
const sinIA = () => new Asistente({ buscador, repositorio });

/** IA falsa que devuelve una respuesta distinta en cada llamada (para el flujo de dos pasos). */
function iaSecuencia(...respuestas) {
  const ia = async () => JSON.stringify(respuestas[ia.llamadas++]);
  ia.llamadas = 0;
  return ia;
}

test("HU-06: si la IA dice que nada de la base responde, se deriva a la OIRS con registros oficiales", async () => {
  const r = await conIA(iaFalsa({ ids: [], respuesta: "" })).responder("como pido un uber al aeropuerto");
  assert.strictEqual(r.tipo, "sin_respuesta");
  assert.deepStrictEqual(r.faqs.map((f) => f.id), [270, 273]);   // canales oficiales (registros de la base)
  assert.match(r.mensaje, /gsv-oirsdigital\.penalolen\.cl/);
});

test("una consulta sin palabras útiles no gasta una llamada a la IA", async () => {
  const ia = iaFalsa({ ids: [3], respuesta: "x" });
  const r = await conIA(ia).responder("¿¿ ??");
  assert.strictEqual(r.tipo, "sin_respuesta");
  assert.strictEqual(ia.llamadas, 0);
});

test("la IA ve el índice COMPLETO: puede elegir un registro que el buscador no encontró (2 pasos)", async () => {
  // El buscador no trae el registro 259 (renovar cédula) para esta consulta, pero la IA lo ve en el índice.
  const consulta = "donde queda la piscina temperada";
  assert.ok(!buscador.buscar(consulta, 10).some((c) => c.faq.id === 259));
  const ia = iaSecuencia({ ids: [259], respuesta: "" }, { respuesta: "Para renovar tu cédula debes reservar hora." });
  const r = await conIA(ia).responder(consulta);
  assert.strictEqual(ia.llamadas, 2);
  assert.strictEqual(r.fuente, "ia");
  assert.strictEqual(r.faqs[0].id, 259);
  assert.strictEqual(r.mensaje, "Para renovar tu cédula debes reservar hora.");
});

test("el índice que recibe la IA incluye todas las preguntas activas de la base", () => {
  const { systemPrompt } = require("../lib/prompt");
  const p = systemPrompt([], FAQS);
  assert.ok(FAQS.every((f) => p.includes(`${f.id}: ${f.pregunta}`)));
});

test("HU-01: la IA redacta con datos del registro → se muestra su respuesta, con la Dirección y el N° de registro", async () => {
  const r = await conIA(iaFalsa({ ids: [3], respuesta: "La piscina temperada está en Ricardo Grellet de los Reyes #2101." }))
    .responder("donde queda la piscina temperada");
  assert.strictEqual(r.tipo, "respuesta");
  assert.strictEqual(r.fuente, "ia");
  assert.strictEqual(r.mensaje, "La piscina temperada está en Ricardo Grellet de los Reyes #2101.");
  assert.strictEqual(r.faqs[0].id, 3);
  assert.strictEqual(r.faqs[0].direccion, "Corporación Deportes");
});

test("la IA puede combinar hasta 3 registros (ej: dónde y cómo renovar la licencia)", async () => {
  const r = await conIA(iaFalsa({ ids: [255, 467], respuesta: "Agenda tu hora el día 15 de cada mes desde las 10:30 hrs en www.penalolen.cl. El trámite se hace en Tránsito, Av. Grecia 8735." }))
    .responder("donde tengo que ir a renovar mi licencia de conducir");
  assert.strictEqual(r.fuente, "ia");
  assert.deepStrictEqual(r.faqs.map((f) => f.id), [255, 467]);
});

test("VERIFICACIÓN: si la IA pone un dato que no está en el registro, se le pide corregirlo y se muestra la corrección", async () => {
  const ia = iaSecuencia(
    { ids: [3], respuesta: "Queda en Ricardo Grellet #2101 y abre de 9:00 a 18:00." },
    { respuesta: "Queda en Ricardo Grellet de los Reyes #2101." });
  const r = await conIA(ia).responder("donde queda la piscina temperada");
  assert.strictEqual(ia.llamadas, 2);
  assert.strictEqual(r.fuente, "ia-corregida");
  assert.strictEqual(r.mensaje, "Queda en Ricardo Grellet de los Reyes #2101.");
});

test("VERIFICACIÓN: si la corrección también trae datos inventados, se muestra el texto oficial", async () => {
  const r = await conIA(iaFalsa({ ids: [3], respuesta: "Queda en Ricardo Grellet #2101 y abre de 9:00 a 18:00." }))
    .responder("donde queda la piscina temperada");
  assert.strictEqual(r.fuente, "ia-texto-oficial");
  assert.strictEqual(r.mensaje, faq(3).respuesta);
});

test("VERIFICACIÓN: si se descarta la redacción y eran varios registros, se muestra el texto oficial de TODOS", async () => {
  const r = await conIA(iaFalsa({ ids: [255, 467], respuesta: "Agenda tu hora el día 20 en www.penalolen.cl." }))
    .responder("donde tengo que ir a renovar mi licencia de conducir");
  assert.strictEqual(r.fuente, "ia-texto-oficial");
  assert.deepStrictEqual(r.faqs.map((f) => f.id), [255, 467]);
  assert.strictEqual(r.mensaje, `${faq(255).respuesta}\n\n${faq(467).respuesta}`);
});

test("VERIFICACIÓN: si la IA inventa un enlace, se muestra el texto oficial", async () => {
  const r = await conIA(iaFalsa({ ids: [3], respuesta: "Revisa www.piscina-falsa.cl" })).responder("donde queda la piscina temperada");
  assert.strictEqual(r.fuente, "ia-texto-oficial");
});

test("anti-invención: si la IA elige IDs que no existen en la base, se descartan", async () => {
  const r = await conIA(iaFalsa({ ids: [99999], respuesta: "x" })).responder("donde queda la piscina temperada");
  assert.strictEqual(r.fuente, "buscador");
  assert.notStrictEqual(r.faqs[0]?.id, 99999);
});

test("si la IA dice que ningún registro sirve (ids vacío), se deriva", async () => {
  const r = await conIA(iaFalsa({ ids: [], respuesta: "" })).responder("cuanto cuesta la bencina esta semana");
  assert.strictEqual(r.tipo, "sin_respuesta");
  assert.strictEqual(r.fuente, "ia");
});

test("si la IA falla (sin internet / saturada / límite del plan gratuito), responde el buscador", async () => {
  const r = await conIA(iaFalsa(new Error("LLM 503: high demand"))).responder("donde queda la piscina temperada");
  assert.strictEqual(r.tipo, "respuesta");
  assert.strictEqual(r.fuente, "buscador");
  assert.strictEqual(r.mensaje, faq(3).respuesta);
});

test("si la primera respuesta de la IA llega cortada, se reintenta y se usa la segunda", async () => {
  const ia = async () => (ia.llamadas++ === 0 ? '{"ids": [3], "respues' : JSON.stringify({ ids: [3], respuesta: "Queda en Ricardo Grellet de los Reyes #2101." }));
  ia.llamadas = 0;
  const r = await conIA(ia).responder("donde queda la piscina temperada");
  assert.strictEqual(ia.llamadas, 2);
  assert.strictEqual(r.fuente, "ia");
});

test("si la IA responde algo que no es JSON (también en el reintento), responde el buscador", async () => {
  const r = await conIA(iaFalsa("La piscina queda en algún lugar")).responder("donde queda la piscina temperada");
  assert.strictEqual(r.fuente, "buscador");
});

test("modo sin IA: responde con el texto oficial cuando el buscador está seguro", async () => {
  const r = await sinIA().responder("cuanto cuesta el permiso de circulacion");
  assert.strictEqual(r.tipo, "respuesta");
  assert.strictEqual(r.faqs[0].id, 788);
  assert.strictEqual(r.mensaje, faq(788).respuesta);
});

test("datos personales: no se procesa la consulta ni se envía a la IA", async () => {
  const ia = iaFalsa({ ids: [3], respuesta: "x" });
  const r = await conIA(ia).responder("mi rut es 12.345.678-9, donde queda la piscina");
  assert.strictEqual(r.tipo, "datos_personales");
  assert.strictEqual(ia.llamadas, 0);
});

test("detecta RUT, correo y celular", () => {
  assert.ok(contieneDatosPersonales("12345678-k"));
  assert.ok(contieneDatosPersonales("escribanme a ana@gmail.com"));
  assert.ok(contieneDatosPersonales("mi fono +56 9 1234 5678"));
  assert.ok(!contieneDatosPersonales("requisitos ds27 para 2026"));
});

test("verificarRespuesta acepta datos copiados del registro (aunque cambie 08:30 por 8:30)", () => {
  const registro = [faq(242)];   // "Lunes a viernes, de 08:30 a 13:30 hrs ... Av. Grecia #8735"
  assert.ok(verificarRespuesta("Atienden de lunes a viernes de 8:30 a 13:30 hrs en Av. Grecia 8735.", registro).ok);
  assert.deepStrictEqual(verificarRespuesta("Atienden de 9:00 a 13:30 hrs.", registro).faltantes, ["9", "0"]);
});

test("verificarRespuesta acepta enlaces del registro y rechaza otros", () => {
  const registro = [faq(270)];   // https://gsv-oirsdigital.penalolen.cl/login
  assert.ok(verificarRespuesta("Entra a https://gsv-oirsdigital.penalolen.cl/login", registro).ok);
  assert.ok(!verificarRespuesta("Entra a https://otro-sitio.cl", registro).ok);
});

test("leerJSON acepta el JSON envuelto en ```json``` y rechaza texto inválido", () => {
  assert.deepStrictEqual(leerJSON('```json\n{"ids": [5], "respuesta": "Hola"}\n```'), { ids: [5], respuesta: "Hola" });
  assert.strictEqual(leerJSON("no sé"), null);
});

test("consulta vacía", async () => {
  assert.strictEqual((await sinIA().responder("   ")).tipo, "vacia");
});

