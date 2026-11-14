// Chat del vecino. Todo el texto se inserta con textContent (nunca innerHTML) para evitar inyección de código.
const $ = (sel) => document.querySelector(sel);
const mensajes = $("#mensajes");
const input = $("#consulta");
const boton = $("#enviar");


const URL_RE = /(https?:\/\/[^\s,;)<>"]+|www\.[^\s,;)<>"]+)/gi;

function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function enlace(url, texto) {
  const href = /^www\./i.test(url) ? "https://" + url : url;
  if (!/^https?:\/\//i.test(href)) return document.createTextNode(texto || url);
  const a = el("a", "", texto || url);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

/** Texto con los enlaces convertidos en links (sin usar innerHTML). */
function textoConEnlaces(texto) {
  const p = el("p", "respuesta");
  let ultimo = 0;
  for (const m of texto.matchAll(URL_RE)) {
    p.append(texto.slice(ultimo, m.index));
    const url = m[0].replace(/[.:]+$/, "");
    p.append(enlace(url));
    ultimo = m.index + url.length;
  }
  p.append(texto.slice(ultimo));
  return p;
}

/** De dónde sale la respuesta (trazabilidad) + texto oficial desplegable. */
function fuentes(faqs, conTextoOficial = true) {
  const cont = el("div", "fuentes");
  const direcciones = [...new Set(faqs.map((f) => f.direccion))];
  const ids = faqs.map((f) => f.id);
  const numeros = ids.length > 1 ? `${ids.slice(0, -1).join(", ")} y ${ids.at(-1)}` : ids[0];
  cont.append(el("p", "fuente-linea", `Responsable: ${direcciones.join(" y ")}`),
              el("p", "fuente-linea", `${ids.length > 1 ? "Registros oficiales" : "Registro oficial"} N° ${numeros}`));
  if (!conTextoOficial) return cont;
  const det = el("details", "oficial");
  det.append(el("summary", "", "Ver el texto oficial"));
  faqs.forEach((f) => det.append(el("p", "oficial-pregunta", f.pregunta), textoConEnlaces(f.respuesta)));
  cont.append(det);
  return cont;
}

function botonesEnlaces(faqs) {
  const urls = [...new Set(faqs.flatMap((f) => f.enlaces))];
  if (!urls.length) return null;
  const acciones = el("div", "acciones");
  urls.forEach((url) => {
    const host = new URL(/^www\./i.test(url) ? "https://" + url : url).hostname.replace(/^www\./, "");
    acciones.append(Object.assign(enlace(url, urls.length > 1 ? `Ir a ${host}` : "Ir al sitio oficial"), { className: "boton-enlace" }));
  });
  return acciones;
}

function burbuja(rol, contenido) {
  const li = el("li", `msg ${rol}`);
  contenido.forEach((c) => li.append(typeof c === "string" ? el("p", "", c) : c));
  mensajes.append(li);
  li.scrollIntoView({ behavior: "smooth", block: "end" });
  return li;
}

function chips(preguntas, titulo) {
  const cont = el("div", "relacionadas");
  if (titulo) cont.append(el("p", "titulo-chips", titulo));
  preguntas.forEach((p) => {
    const b = el("button", "chip", p.pregunta);
    b.type = "button";
    b.addEventListener("click", () => enviar(p.pregunta));
    cont.append(b);
  });
  return cont;
}

function mostrarRespuesta(r) {
  const partes = [textoConEnlaces(r.mensaje)];
  const faqs = r.faqs || [];
  if (r.tipo === "respuesta" || r.tipo === "sin_respuesta") {
    const botones = botonesEnlaces(faqs);
    if (botones) partes.push(botones);
    else if (r.tipo === "respuesta") partes.push(el("p", "nota", `Para continuar el trámite, acude a ${faqs[0].direccion}.`));
    if (faqs.length) partes.push(fuentes(faqs, r.fuente !== "faq"));   // si ya es el texto oficial, no se repite
  }
  if (r.relacionadas?.length) {
    const titulo = r.tipo === "respuesta" ? "También te puede servir" : "¿Buscabas alguna de estas?";
    partes.push(chips(r.relacionadas, titulo));
  }
  burbuja("bot", partes);
}

async function enviar(texto) {
  texto = texto.trim();
  if (!texto || boton.disabled) return;
  burbuja("vecino", [texto]);
  input.value = "";
  boton.disabled = true;
  const espera = burbuja("bot", [el("p", "escribiendo", "Revisando la información oficial…")]);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta: texto }),
    });
    if (!res.ok) throw new Error(res.status);
    espera.remove();
    mostrarRespuesta(await res.json());
  } catch {
    espera.remove();
    burbuja("bot", ["Tuvimos un problema de conexión. Intenta de nuevo en unos segundos."]);
  } finally {
    boton.disabled = false;
    input.focus();
  }
}

$("#formulario").addEventListener("submit", (e) => { e.preventDefault(); enviar(input.value); });
// --- Preguntas frecuentes por tema (respuestas oficiales directas, sin IA) ---
async function verPregunta(p) {
  burbuja("vecino", [p.pregunta]);
  try {
    const res = await fetch(`/api/faq/${p.id}`);
    if (!res.ok) throw new Error(res.status);
    mostrarRespuesta(await res.json());
  } catch {
    burbuja("bot", ["No pude cargar esa respuesta. Intenta de nuevo en unos segundos."]);
  }
}

function mostrarTema(tema) {
  const lista = el("div", "lista-faq");
  tema.preguntas.forEach((p) => {
    const b = el("button", "faq", p.pregunta);
    b.type = "button";
    b.addEventListener("click", () => verPregunta(p));
    lista.append(b);
  });
  burbuja("bot", [`Estas son las preguntas frecuentes sobre ${tema.nombre.toLowerCase()}. Elige una o escribe tu duda abajo.`, lista]);
}

(async () => {
  try {
    const temas = await (await fetch("/api/temas")).json();
    temas.forEach((t) => {
      const b = el("button", "tema", t.nombre);
      b.type = "button";
      b.addEventListener("click", () => mostrarTema(t));
      $("#temas").append(b);
    });
  } catch { /* sin temas, el chat funciona igual */ }
})();
