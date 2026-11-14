// Servidor web del Asistente Virtual de Trámites y Servicios Municipales (Peñalolén).
// Node 18+ y sin dependencias externas. Basado en server.js del repo MUNIA (afcarvallo/munia-hands-on).
//
// Rutas públicas
//   GET  /                     → chat para el vecino (public/index.html)
//   POST /api/chat             → { consulta } → respuesta del asistente (JSON)
//   GET  /api/estado           → cuántas preguntas hay y si la IA está activa
//   GET  /api/temas            → temas de la portada con sus preguntas frecuentes
//   GET  /api/faq/:id          → respuesta oficial de una pregunta (sin pasar por la IA)
// Panel de administración (HU-07)
//   GET  /admin                → panel (public/admin.html)
//   POST /api/admin/login      → { usuario, clave } → cookie de sesión
//   POST /api/admin/logout
//   GET  /api/admin/sesion     → ¿hay sesión activa?
//   GET  /api/admin/faqs?q=    → lista/búsqueda de preguntas          (requiere sesión)
//   GET  /api/admin/opciones   → direcciones y categorías válidas     (requiere sesión)
//   POST /api/admin/faqs       → crea una pregunta                    (requiere sesión)
//   PUT  /api/admin/faqs/:id   → edita una pregunta                   (requiere sesión)

const http = require("http");
const fs = require("fs");
const path = require("path");

const { Buscador } = require("./lib/buscador");
const { Repositorio, CATEGORIAS } = require("./lib/repositorio");
const { Asistente } = require("./lib/asistente");
const { Autenticacion, DURACION_SESION_MS } = require("./lib/auth");
const { llamarLLM, iaConfigurada } = require("./lib/llm");

// --- .env mínimo (igual que en MUNIA) ----------------------------------------------------------
function cargarEnv(ruta = path.join(__dirname, ".env")) {
  if (!fs.existsSync(ruta)) return;
  for (const linea of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const LIMITE_BODY = 20 * 1024;

// Cabeceras de seguridad en todas las respuestas (sin scripts externos ni en línea).
const CABECERAS_SEGURIDAD = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function leerBody(req) {
  return new Promise((ok, mal) => {
    let data = "", demasiado = false;
    req.on("data", (c) => {
      if (demasiado) return;                       // se descarta el resto sin guardarlo en memoria
      data += c;
      if (data.length > LIMITE_BODY) { demasiado = true; data = ""; }
    });
    req.on("end", () => {
      if (demasiado) return mal(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
      try { ok(JSON.parse(data || "{}")); } catch { mal(Object.assign(new Error("JSON inválido"), { status: 400 })); }
    });
  });
}

function json(res, status, datos, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CABECERAS_SEGURIDAD, ...extra });
  res.end(JSON.stringify(datos));
}

function leerCookie(req, nombre) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${nombre}=([a-f0-9]+)`));
  return m ? m[1] : null;
}

/**
 * Arma la aplicación. Recibe sus dependencias para poder probarla con datos y una IA falsos.
 * @param {{ rutaFaqs: string, rutaDirecciones?: string, auth: Autenticacion, llamarLLM?: Function, iaActiva?: () => boolean }} config
 */
function crearApp({ rutaFaqs, rutaDirecciones, rutaTemas, auth, llamarLLM: llm = null, iaActiva = () => false }) {
  const direcciones = rutaDirecciones && fs.existsSync(rutaDirecciones) ? JSON.parse(fs.readFileSync(rutaDirecciones, "utf8")) : [];
  const temas = rutaTemas && fs.existsSync(rutaTemas) ? JSON.parse(fs.readFileSync(rutaTemas, "utf8")) : [];
  const repositorio = new Repositorio(rutaFaqs, { direcciones });
  const buscador = new Buscador(repositorio.listar());
  repositorio.alCambiar = (faqs) => buscador.indexar(faqs);        // los cambios del panel se ven en la consulta siguiente
  const asistente = new Asistente({ buscador, repositorio, llamarLLM: llm, iaActiva });

  const ipDe = (req) => req.socket.remoteAddress || "local";
  const sesion = (req) => auth.validarSesion(leerCookie(req, "sesion"));

  async function api(req, res, url) {
    const { pathname } = url;
    const m = req.method;

    if (m === "POST" && pathname === "/api/chat") {
      const { consulta } = await leerBody(req);
      const r = await asistente.responder(consulta);
      console.log(`[chat] ${r.tipo} (${r.fuente || "-"})${r.faqs?.[0] && r.tipo === "respuesta" ? ` → registro ${r.faqs[0].id}` : ""}`);  // no se guarda el texto de la consulta
      return json(res, 200, r);
    }
    // Preguntas frecuentes por tema: respuestas oficiales directas, sin gastar consultas de la IA.
    if (m === "GET" && pathname === "/api/temas") {
      // Cada pregunta es un ID, o { id, titulo } cuando el título de la base tiene errores de tipeo:
      // el título corregido solo se usa en el botón; la respuesta sigue siendo el texto oficial.
      const activas = (lista) => lista.map((p) => (typeof p === "number" ? { id: p } : p))
        .map((p) => ({ ...p, faq: repositorio.obtener(p.id) })).filter((p) => p.faq && p.faq.activo !== false)
        .map((p) => ({ id: p.id, pregunta: p.titulo || p.faq.pregunta }));
      return json(res, 200, temas.map((t) => ({ nombre: t.nombre, preguntas: activas(t.preguntas) })).filter((t) => t.preguntas.length));
    }
    const mFaq = pathname.match(/^\/api\/faq\/(\d+)$/);
    if (m === "GET" && mFaq) {
      const f = repositorio.obtener(mFaq[1]);
      if (!f || f.activo === false) return json(res, 404, { error: "Pregunta no encontrada" });
      console.log(`[faq] respuesta oficial directa → registro ${f.id}`);
      // Otras preguntas relacionadas: las más parecidas según el buscador, sin repetir textos.
      const vistos = new Set([f.pregunta.toLowerCase()]);
      const relacionadas = buscador.buscar(f.pregunta, 10)
        .filter((c) => c.faq.id !== f.id && !vistos.has(c.faq.pregunta.toLowerCase()) && vistos.add(c.faq.pregunta.toLowerCase()))
        .slice(0, 3).map((c) => ({ id: c.faq.id, pregunta: c.faq.pregunta }));
      return json(res, 200, { tipo: "respuesta", fuente: "faq", mensaje: f.respuesta, relacionadas,
        faqs: [{ id: f.id, pregunta: f.pregunta, respuesta: f.respuesta, direccion: f.direccion, enlaces: f.enlaces || [] }] });
    }
    if (m === "GET" && pathname === "/api/estado")
      return json(res, 200, { preguntas: repositorio.listar().length, ia: iaActiva() });

    // --- administración ---
    if (m === "POST" && pathname === "/api/admin/login") {
      const { usuario, clave } = await leerBody(req);
      const r = auth.iniciarSesion(usuario, clave, ipDe(req));
      if (r.error) return json(res, r.bloqueado ? 429 : 401, { error: r.error });
      return json(res, 200, { ok: true }, {
        "Set-Cookie": `sesion=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_SESION_MS / 1000}`,
      });
    }
    if (m === "POST" && pathname === "/api/admin/logout") {
      auth.cerrarSesion(leerCookie(req, "sesion"));
      return json(res, 200, { ok: true }, { "Set-Cookie": "sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }
    if (m === "GET" && pathname === "/api/admin/sesion") return json(res, 200, { usuario: sesion(req) });

    if (pathname.startsWith("/api/admin/")) {
      const usuario = sesion(req);
      if (!usuario) return json(res, 401, { error: "Debes iniciar sesión." });

      if (m === "GET" && pathname === "/api/admin/opciones") return json(res, 200, { direcciones, categorias: CATEGORIAS });
      if (m === "GET" && pathname === "/api/admin/faqs") {
        const lista = repositorio.filtrar(url.searchParams.get("q") || "");
        return json(res, 200, { total: lista.length, faqs: lista.slice(0, 100) });
      }
      if (m === "POST" && pathname === "/api/admin/faqs") {
        const r = repositorio.crear(await leerBody(req));
        if (r.errores) return json(res, 400, { errores: r.errores });
        console.log(`[admin] ${usuario} creó el registro ${r.faq.id}`);
        return json(res, 201, r.faq);
      }
      const mId = pathname.match(/^\/api\/admin\/faqs\/(\d+)$/);
      if (m === "PUT" && mId) {
        const r = repositorio.actualizar(mId[1], await leerBody(req));
        if (r.errores) return json(res, r.noEncontrado ? 404 : 400, { errores: r.errores });
        console.log(`[admin] ${usuario} editó el registro ${r.faq.id}`);
        return json(res, 200, r.faq);
      }
    }
    return json(res, 404, { error: "No encontrado" });
  }

  function archivoEstatico(req, res, url) {
    const nombre = url.pathname === "/" ? "index.html" : url.pathname === "/admin" ? "admin.html" : url.pathname;
    const archivo = path.normalize(path.join(PUBLIC, nombre));
    if (!archivo.startsWith(PUBLIC) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404, CABECERAS_SEGURIDAD);
      return res.end("No encontrado");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(archivo)] || "application/octet-stream", "Cache-Control": "no-cache", ...CABECERAS_SEGURIDAD });
    fs.createReadStream(archivo).pipe(res);
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return archivoEstatico(req, res, url);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : "Error interno" });
      else res.end();
    }
  });
  return { servidor, repositorio, buscador, asistente };
}

module.exports = { crearApp, cargarEnv };

if (require.main === module) {
  cargarEnv();
  process.env.BASE_URL ||= "https://generativelanguage.googleapis.com/v1beta/openai";
  process.env.MODEL ||= "gemini-2.5-flash";
  const auth = new Autenticacion({ usuario: process.env.ADMIN_USER, hash: process.env.ADMIN_PASS_HASH });
  const { servidor, repositorio } = crearApp({
    rutaFaqs: path.join(__dirname, "data/faqs.json"),
    rutaDirecciones: path.join(__dirname, "data/direcciones.json"),
    rutaTemas: path.join(__dirname, "data/temas.json"),
    auth,
    llamarLLM: (messages) => llamarLLM(messages),
    iaActiva: () => iaConfigurada(),
  });
  const puerto = Number(process.env.PORT || 3000);
  servidor.listen(puerto, () => {
    console.log(`Asistente municipal en http://localhost:${puerto}  ·  panel: http://localhost:${puerto}/admin`);
    console.log(`${repositorio.listar().length} preguntas cargadas · IA: ${iaConfigurada() ? `activa (${process.env.MODEL})` : "desactivada (solo buscador)"}`);
    if (!auth.configurada()) console.warn("⚠  Panel sin administrador: ejecuta  npm run crear-admin");
  });
}
