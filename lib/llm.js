// Conexión con el modelo de IA (API compatible con OpenAI), adaptada de lib/llm.js del repo MUNIA.
//
// Usamos Google Gemini (plan gratuito) a través de su endpoint compatible con OpenAI. Cambiar de
// proveedor (Groq, OpenRouter, Ollama local…) es editar BASE_URL y MODEL en .env: el resto del
// sistema no se entera (bajo acoplamiento con el proveedor).
//
// Diferencias con MUNIA: no usamos streaming (necesitamos la respuesta completa para validarla
// antes de mostrarla), hay un tiempo máximo de espera (30 s) y, si el modelo principal llegó a su límite
// del plan gratuito (429) o está saturado (503), probamos con el modelo de respaldo (MODEL_RESPALDO).

const TIEMPO_MAXIMO_MS = 30000;
const ERRORES_REINTENTABLES = [429, 500, 502, 503, 504];

// Gemini 2.5 "piensa" antes de responder y ese pensamiento cuenta dentro de max_tokens. Con un límite
// bajo (antes era 2048) podía gastarlo todo pensando y dejar la respuesta vacía o cortada. Por eso:
//   - LLM_MAX_TOKENS (por defecto 8192): espacio total para pensar + responder.
//   - LLM_RAZONAMIENTO (por defecto "low"): cuánto piensa. "low" ≈ 1.000 tokens de pensamiento,
//     suficiente para elegir y redactar; "medium" si hiciera falta más (subir también LLM_MAX_TOKENS).
//   - response_format JSON: le pide responder siempre con un JSON válido.
// Si el proveedor no acepta alguna de estas opciones (error 400), se reintenta sin ellas.

/** ¿Hay una API key configurada? Si no, el asistente funciona solo con el buscador. */
function iaConfigurada(env = process.env) {
  const k = env.API_KEY || "";
  return k.length > 10 && !k.includes("PEGA_AQUI");
}

async function enviar(cuerpo, env) {
  return fetch(`${env.BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.API_KEY}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
}

async function llamarModelo(modelo, messages, env) {
  const base = { model: modelo, messages, temperature: 0, max_tokens: Number(env.LLM_MAX_TOKENS) || 8192 };
  const extras = { response_format: { type: "json_object" } };
  if (env.LLM_RAZONAMIENTO !== "ninguno") extras.reasoning_effort = env.LLM_RAZONAMIENTO || "low";

  let respuesta = await enviar({ ...base, ...extras }, env);
  if (respuesta.status === 400) {
    console.warn(`[llm] ${modelo} no aceptó response_format/reasoning_effort (${(await respuesta.text()).slice(0, 120)}): reintento sin ellas`);
    respuesta = await enviar(base, env);
  }
  if (!respuesta.ok) {
    const error = new Error(`LLM ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
    error.status = respuesta.status;
    throw error;
  }
  const datos = await respuesta.json();
  const opcion = datos.choices?.[0];
  const contenido = opcion?.message?.content || "";
  // Aviso de diagnóstico: si la respuesta no terminó normalmente (ej. "length" = se quedó sin tokens).
  if (opcion?.finish_reason && opcion.finish_reason !== "stop")
    console.warn(`[llm] ${modelo} terminó por "${opcion.finish_reason}" (tokens usados: ${JSON.stringify(datos.usage || {})})`);
  if (!contenido) console.warn(`[llm] ${modelo} devolvió una respuesta vacía (motivo: ${opcion?.finish_reason || "desconocido"})`);
  return contenido;
}

/**
 * Envía la conversación al modelo y devuelve el texto de la respuesta.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function llamarLLM(messages, env = process.env, esperaMs = 1500) {
  try {
    try {
      return await llamarModelo(env.MODEL, messages, env);
    } catch (e) {
      // 503 = saturación momentánea de Google: se reintenta una vez tras una pausa corta.
      if (e.status !== 503) throw e;
      await new Promise((r) => setTimeout(r, esperaMs));
      return await llamarModelo(env.MODEL, messages, env);
    }
  } catch (e) {
    // 429 = se acabó el límite del plan gratuito; 500/502/503/504 = el modelo está saturado o caído.
    // En esos casos probamos con el modelo de respaldo antes de rendirnos.
    if (ERRORES_REINTENTABLES.includes(e.status) && env.MODEL_RESPALDO && env.MODEL_RESPALDO !== env.MODEL) {
      console.warn(`[llm] ${env.MODEL} respondió ${e.status}: pruebo con ${env.MODEL_RESPALDO}`);
      return await llamarModelo(env.MODEL_RESPALDO, messages, env);
    }
    throw e;
  }
}

module.exports = { llamarLLM, iaConfigurada };
