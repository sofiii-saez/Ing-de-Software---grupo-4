// Pruebas de la conexión con la IA, con un fetch FALSO (no usa internet).
const test = require("node:test");
const assert = require("node:assert");
const { llamarLLM, iaConfigurada } = require("../lib/llm");

const ENV = { API_KEY: "clave-de-prueba-123", BASE_URL: "https://ejemplo", MODEL: "principal", MODEL_RESPALDO: "respaldo" };

function fetchFalso(respuestasPorModelo) {
  const llamados = [];
  global.fetch = async (_url, opciones) => {
    const { model } = JSON.parse(opciones.body);
    llamados.push(model);
    const status = respuestasPorModelo[model];
    if (status === 200) return { ok: true, status, json: async () => ({ choices: [{ message: { content: `ok-${model}` }, finish_reason: "stop" }] }) };
    return { ok: false, status, text: async () => "error" };
  };
  return llamados;
}

test("usa el modelo principal cuando responde bien", async () => {
  const llamados = fetchFalso({ principal: 200 });
  assert.strictEqual(await llamarLLM([], ENV, 0), "ok-principal");
  assert.deepStrictEqual(llamados, ["principal"]);
});

test("si el principal responde 429 (sin cuota), usa el modelo de respaldo", async () => {
  const llamados = fetchFalso({ principal: 429, respaldo: 200 });
  assert.strictEqual(await llamarLLM([], ENV, 0), "ok-respaldo");
  assert.deepStrictEqual(llamados, ["principal", "respaldo"]);
});

test("si el principal responde 503 (saturado), reintenta una vez y luego usa el respaldo", async () => {
  const llamados = fetchFalso({ principal: 503, respaldo: 200 });
  assert.strictEqual(await llamarLLM([], ENV, 0), "ok-respaldo");
  assert.deepStrictEqual(llamados, ["principal", "principal", "respaldo"]);
});

test("un error 401 (key mala) no se reintenta", async () => {
  const llamados = fetchFalso({ principal: 401, respaldo: 200 });
  await assert.rejects(llamarLLM([], ENV, 0), /LLM 401/);
  assert.deepStrictEqual(llamados, ["principal"]);
});

test("sin API key la IA queda desactivada", () => {
  assert.strictEqual(iaConfigurada({ API_KEY: "PEGA_AQUI_TU_API_KEY" }), false);
  assert.strictEqual(iaConfigurada({ API_KEY: "" }), false);
  assert.strictEqual(iaConfigurada(ENV), true);
});

test("pide respuesta en JSON, pensamiento bajo y 8192 tokens; si el proveedor no lo acepta (400), reintenta sin eso", async () => {
  const cuerpos = [];
  global.fetch = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    cuerpos.push(cuerpo);
    if (cuerpo.reasoning_effort) return { ok: false, status: 400, text: async () => "unknown field" };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }) };
  };
  assert.strictEqual(await llamarLLM([], ENV, 0), "ok");
  assert.strictEqual(cuerpos[0].max_tokens, 8192);
  assert.strictEqual(cuerpos[0].reasoning_effort, "low");
  assert.deepStrictEqual(cuerpos[0].response_format, { type: "json_object" });
  assert.strictEqual(cuerpos[1].reasoning_effort, undefined);
});
