// Lógica del asistente: decide qué responder a una consulta del vecino.
//
//   consulta ──► ¿trae datos personales? ──sí──► aviso, no se procesa ni se envía a la IA
//        │
//        ▼
//   Buscador por palabras (10 candidatos más parecidos)
//        │
//   ¿IA configurada? ──no──► responde el buscador si está seguro (texto oficial); si no, deriva
//        │ sí
//        ▼
//   IA recibe el ÍNDICE de las 843 preguntas (solo títulos) + el texto completo de los 10 candidatos.
//   Elige los registros que responden (buscando en TODO el índice, no solo en los candidatos) y
//   redacta la respuesta con su texto. Si eligió un registro fuera de los candidatos, se le envía
//   su texto en un segundo paso para que redacte. Si ninguno responde → derivación (HU-06).
//        │
//        ├─ se descartan IDs que no existen en la base (anti-invención)
//        ├─ VERIFICACIÓN: cada número, enlace y correo de la respuesta debe estar en los registros
//        │  elegidos. Si algo no está, se le pide a la IA que corrija esos datos (una vez). Si la
//        │  corrección tampoco pasa, se muestra el texto oficial de todos los registros elegidos.
//        └─ si la IA falla (sin internet, saturada, límite del plan gratuito…) ──► buscador
//
// Toda respuesta muestra la Dirección responsable y el N° de registro de donde salió (trazabilidad),
// y el vecino puede abrir el texto oficial completo para comprobarla.

const { systemPrompt, promptRedaccion } = require("./prompt");
const { terminosConsulta } = require("./buscador");

const CANDIDATOS = 10;           // registros que la IA recibe con su texto completo (del resto ve solo el título)
const MAX_REGISTROS = 3;         // cuántos registros puede combinar la IA en una respuesta
const PUNTAJE_MINIMO_IA = 0.15;  // modo sin IA: bajo esto ni siquiera se intenta responder
const LARGO_MAXIMO = 500;        // caracteres de la consulta
const LARGO_MAXIMO_RESPUESTA = 1200;

const PATRONES_DATOS_PERSONALES = [
  /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/,         // RUT
  /[\w.+-]+@[\w-]+\.[\w.]+/,                     // correo
  /(\+?56)?\s?9\s?\d{4}\s?\d{4}\b/,              // celular chileno
];

function contieneDatosPersonales(texto) {
  return PATRONES_DATOS_PERSONALES.some((re) => re.test(texto));
}

/** Extrae el primer objeto JSON del texto de la IA (a veces lo envuelve en ```json … ```). */
function leerJSON(texto) {
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Números (sin ceros a la izquierda ni separadores de miles), enlaces y correos de un texto. */
function datosVerificables(texto) {
  const t = String(texto).toLowerCase();
  const enlaces = (t.match(/(https?:\/\/[^\s,;)<>"]+|www\.[^\s,;)<>"]+)/g) || [])
    .map((u) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.:/]+$/, ""));
  const correos = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  const sinEnlaces = t.replace(/(https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w-]+\.[\w.]+)/g, " ");
  const numeros = (sinEnlaces.replace(/(\d)\.(\d{3})\b/g, "$1$2").match(/\d+/g) || []).map((n) => String(Number(n)));
  return { numeros, enlaces, correos };
}

/**
 * Verifica que la respuesta redactada por la IA no traiga datos que no estén en los registros
 * oficiales: cada número (horarios, montos, fechas, teléfonos), enlace y correo debe aparecer en ellos.
 * @returns {{ ok: boolean, faltantes: string[] }}
 */
function verificarRespuesta(respuesta, faqs) {
  const fuente = datosVerificables(faqs.map((f) => `${f.pregunta} ${f.respuesta} ${(f.enlaces || []).join(" ")}`).join(" "));
  const textoFuente = faqs.map((f) => `${f.respuesta} ${(f.enlaces || []).join(" ")}`).join(" ").toLowerCase();
  const r = datosVerificables(respuesta);
  const faltantes = [
    ...r.numeros.filter((n) => !fuente.numeros.includes(n)),
    ...r.enlaces.filter((u) => !fuente.enlaces.some((e) => e.startsWith(u) || u.startsWith(e)) && !textoFuente.includes(u)),
    ...r.correos.filter((c) => !fuente.correos.includes(c)),
  ];
  return { ok: faltantes.length === 0, faltantes };
}

/** Mensaje para que la IA corrija una redacción con datos que no están en los registros. */
function pedirCorreccion(faltantes) {
  const detalle = faltantes.length ? `Estos datos de tu respuesta NO aparecen en los registros oficiales: ${faltantes.join(", ")}. ` : "Tu respuesta es demasiado larga. ";
  return `${detalle}Corrige tu respuesta: copia horarios, números, fechas y enlaces EXACTAMENTE como están en los ` +
    `registros, o quita el dato si no está en ellos. Mantén el mismo estilo. Responde SOLO con el JSON {"respuesta": "..."}.`;
}

/** Datos del registro que se envían a la página (fuente de la respuesta). */
function fuenteDe(faq) {
  return { id: faq.id, pregunta: faq.pregunta, respuesta: faq.respuesta, direccion: faq.direccion, enlaces: faq.enlaces || [] };
}

class Asistente {
  /**
   * @param {{ buscador: import("./buscador").Buscador, repositorio: object,
   *           llamarLLM?: Function, iaActiva?: () => boolean }} deps
   *        llamarLLM se inyecta para poder probar el asistente sin internet (tests con una IA falsa).
   */
  constructor({ buscador, repositorio, llamarLLM = null, iaActiva = () => Boolean(llamarLLM) }) {
    this.buscador = buscador;
    this.repositorio = repositorio;
    this.llamarLLM = llamarLLM;
    this.iaActiva = iaActiva;
  }

  /** Mensaje de derivación cuando no hay respuesta (HU-06), armado con registros oficiales de la base. */
  derivacion(fuente, relacionadas = []) {
    const canales = [270, 273].map((id) => this.repositorio.obtener(id)).filter(Boolean);
    const lineas = ["No tengo información oficial sobre eso, así que prefiero no adivinar.",
                    "Puedes hacer tu consulta en la OIRS de la Municipalidad:"];
    for (const f of canales) lineas.push(`- ${f.respuesta}`);
    return { tipo: "sin_respuesta", fuente, mensaje: lineas.join("\n"), faqs: canales.map(fuenteDe), relacionadas };
  }

  /**
   * Respuesta con el texto oficial de uno o más registros, tal cual (modo sin IA o si falló la
   * verificación). Si son varios, se muestran todos, uno después del otro, para no perder información.
   */
  textoOficial(faqs, fuente, relacionadas) {
    const lista = Array.isArray(faqs) ? faqs : [faqs];
    return { tipo: "respuesta", fuente, mensaje: lista.map((f) => f.respuesta).join("\n\n"), faqs: lista.map(fuenteDe), relacionadas };
  }

  /**
   * Pide a la IA que elija registros (mirando el índice completo de la base) y redacte la respuesta.
   * Devuelve null si la respuesta de la IA no sirve (y entonces responde el buscador).
   */
  async responderConIA(consulta, candidatos, relacionadas) {
    const catalogo = this.buscador.faqs;     // solo preguntas activas
    const mensajes = [
      { role: "system", content: systemPrompt(candidatos, catalogo) },
      { role: "user", content: consulta },
    ];
    let texto = await this.llamarLLM(mensajes);
    let eleccion = leerJSON(texto);
    if (!eleccion || !Array.isArray(eleccion.ids)) {
      // La respuesta llegó vacía, cortada o sin el formato pedido: se muestra en la terminal qué llegó
      // y se le da a la IA una segunda oportunidad con las mismas opciones antes de usar el buscador.
      console.warn(`[asistente] respuesta de la IA no utilizable, reintento. Llegó: ${JSON.stringify(String(texto).slice(0, 300))}`);
      texto = await this.llamarLLM(mensajes);
      eleccion = leerJSON(texto);
      if (!eleccion || !Array.isArray(eleccion.ids)) {
        console.warn(`[asistente] el reintento tampoco sirvió. Llegó: ${JSON.stringify(String(texto).slice(0, 300))}`);
        return null;
      }
    }
    if (eleccion.ids.length === 0) return this.derivacion("ia", relacionadas());

    // Anti-invención: solo IDs que existen en la base (y están activos).
    const ids = [...new Set(eleccion.ids.map(Number))];
    const elegidos = ids.map((id) => catalogo.find((f) => f.id === id)).filter(Boolean).slice(0, MAX_REGISTROS);
    if (elegidos.length < ids.length) console.warn("[asistente] la IA eligió IDs que no existen en la base: se descartan");
    if (!elegidos.length) return null;
    const usados = elegidos.map((f) => f.id);

    let redaccion = String(eleccion.respuesta || "").trim();
    const fueraDeCandidatos = elegidos.some((f) => !candidatos.some((c) => c.faq.id === f.id));
    if (fueraDeCandidatos) {
      // La IA encontró el registro en el índice, pero no tenía su texto: segundo paso para redactar.
      redaccion = "";
      try {
        const segunda = leerJSON(await this.llamarLLM([
          { role: "system", content: promptRedaccion(elegidos) },
          { role: "user", content: consulta },
        ]));
        redaccion = String(segunda?.respuesta || "").trim();
      } catch (e) {
        console.warn(`[asistente] no se pudo redactar en el segundo paso (${e.message.slice(0, 60)}): muestro el texto oficial`);
      }
    }

    const aceptable = (texto) => texto && texto.length <= LARGO_MAXIMO_RESPUESTA && verificarRespuesta(texto, elegidos).ok;
    if (aceptable(redaccion)) {
      return { tipo: "respuesta", fuente: "ia", mensaje: redaccion, faqs: elegidos.map(fuenteDe), relacionadas: relacionadas(usados) };
    }

    // La redacción traía datos que no están en los registros: le pedimos a la IA que la CORRIJA
    // (una sola vez), diciéndole exactamente qué datos no calzan. Si la corrección tampoco pasa la
    // verificación, se muestra el texto oficial.
    if (redaccion) {
      const { faltantes } = verificarRespuesta(redaccion, elegidos);
      console.warn(`[asistente] la respuesta de la IA no pasó la verificación (${faltantes.join(", ") || "muy larga"}): le pido que la corrija`);
      try {
        const corregida = String(leerJSON(await this.llamarLLM([
          { role: "system", content: promptRedaccion(elegidos) },
          { role: "user", content: consulta },
          { role: "assistant", content: JSON.stringify({ respuesta: redaccion }) },
          { role: "user", content: pedirCorreccion(faltantes) },
        ]))?.respuesta || "").trim();
        if (aceptable(corregida)) {
          return { tipo: "respuesta", fuente: "ia-corregida", mensaje: corregida, faqs: elegidos.map(fuenteDe), relacionadas: relacionadas(usados) };
        }
        console.warn("[asistente] la corrección tampoco pasó la verificación: muestro el texto oficial");
      } catch (e) {
        console.warn(`[asistente] no se pudo pedir la corrección (${e.message.slice(0, 60)}): muestro el texto oficial`);
      }
    }
    return this.textoOficial(elegidos, "ia-texto-oficial", relacionadas(usados));
  }

  /**
   * Responde una consulta.
   * @returns {Promise<{tipo: string, fuente?: string, mensaje: string, faqs: Array, relacionadas?: Array}>}
   *   faqs: registros oficiales de los que sale la respuesta (el primero es el principal)
   */
  async responder(consultaOriginal) {
    const consulta = String(consultaOriginal || "").trim().slice(0, LARGO_MAXIMO);
    if (!consulta) return { tipo: "vacia", mensaje: "Escribe tu pregunta sobre algún trámite, servicio o beneficio municipal.", faqs: [] };

    if (contieneDatosPersonales(consulta)) {
      return {
        tipo: "datos_personales",
        mensaje: "Por tu seguridad, no escribas datos personales como RUT, correo o teléfono. " +
          "Vuelve a escribir tu pregunta sin esos datos y te ayudo.",
        faqs: [],
      };
    }

    const candidatos = this.buscador.buscar(consulta, CANDIDATOS);
    // Sugerencias de otras preguntas, sin repetir textos (la base tiene preguntas duplicadas).
    const relacionadas = (usados = [], cuantas = 3) => {
      const vistos = new Set(candidatos.filter((c) => usados.includes(c.faq.id)).map((c) => c.faq.pregunta.toLowerCase()));
      return candidatos
        .filter((c) => !usados.includes(c.faq.id) && c.puntaje >= PUNTAJE_MINIMO_IA)
        .filter((c) => !vistos.has(c.faq.pregunta.toLowerCase()) && vistos.add(c.faq.pregunta.toLowerCase()))
        .slice(0, cuantas)
        .map((c) => ({ id: c.faq.id, pregunta: c.faq.pregunta }));
    };

    if (this.iaActiva() && terminosConsulta(consulta).length) {
      try {
        const r = await this.responderConIA(consulta, candidatos, relacionadas);
        if (r) return r;
      } catch (e) {
        console.warn(`[asistente] IA no disponible (${e.message.slice(0, 80)}): respondo solo con el buscador`);
      }
    }

    // Modo sin IA (o la IA falló): solo respondemos si el buscador está bastante seguro.
    if (!candidatos.length || candidatos[0].puntaje < PUNTAJE_MINIMO_IA) return this.derivacion("buscador");
    if (this.buscador.hayRespuesta(candidatos)) {
      const mejor = candidatos[0].faq;
      return this.textoOficial(mejor, "buscador", relacionadas([mejor.id]));
    }
    return this.derivacion("buscador", relacionadas());
  }
}

module.exports = { Asistente, contieneDatosPersonales, verificarRespuesta, leerJSON };
