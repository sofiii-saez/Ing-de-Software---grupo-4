// Pruebas de integración del servidor (API real, base temporal, IA falsa).
// Cubren el criterio de aceptación de HU-07: un usuario autorizado inicia sesión, agrega o edita
// una pregunta, y el cambio aparece en las consultas siguientes; sin credenciales no hay acceso.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { crearApp } = require("../server");
const { Autenticacion, hashClave } = require("../lib/auth");

let base, cerrar;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-"));
  const rutaFaqs = path.join(dir, "faqs.json");
  fs.copyFileSync(path.join(__dirname, "../data/faqs.json"), rutaFaqs);
  const auth = new Autenticacion({ usuario: "admin", hash: hashClave("clave-segura-123") });
  const { servidor } = crearApp({ rutaFaqs, rutaDirecciones: path.join(__dirname, "../data/direcciones.json"), rutaTemas: path.join(__dirname, "../data/temas.json"), auth });
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cerrar = () => servidor.close();
});
test.after(() => cerrar());

const post = (ruta, cuerpo, cookie) => fetch(base + ruta, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(cuerpo) });
const chat = async (consulta) => (await post("/api/chat", { consulta })).json();

test("la página del chat carga con cabeceras de seguridad", async () => {
  const r = await fetch(base + "/");
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
});

test("/api/chat responde con un registro oficial", async () => {
  const r = await chat("cuanto cuesta el permiso de circulacion");
  assert.strictEqual(r.faqs[0].id, 788);
});

test("temas de la portada: cada tema trae preguntas que existen en la base", async () => {
  const temas = await (await fetch(base + "/api/temas")).json();
  assert.ok(temas.length >= 6);
  for (const t of temas) assert.ok(t.preguntas.length > 0 && t.preguntas.every((p) => p.id && p.pregunta));
  const permiso = temas.find((t) => t.nombre === "Permiso de circulación");
  assert.ok(permiso.preguntas.some((p) => p.pregunta === "¿Cuánto cuesta mi permiso de circulación?"));   // título corregido
});

test("pregunta frecuente: devuelve la respuesta oficial directa, sin IA", async () => {
  const r = await (await fetch(base + "/api/faq/255")).json();
  assert.strictEqual(r.fuente, "faq");
  assert.strictEqual(r.faqs[0].id, 255);
  assert.ok(r.relacionadas.length > 0 && r.relacionadas.every((x) => x.id !== 255));
  assert.strictEqual((await fetch(base + "/api/faq/999999")).status, 404);
});

test("sin sesión, el panel no entrega datos ni permite crear", async () => {
  assert.strictEqual((await fetch(base + "/api/admin/faqs")).status, 401);
  assert.strictEqual((await post("/api/admin/faqs", { pregunta: "x", respuesta: "y", direccion: "Dirección Tránsito" })).status, 401);
});

test("credenciales incorrectas → 401", async () => {
  assert.strictEqual((await post("/api/admin/login", { usuario: "admin", clave: "mala" })).status, 401);
});

test("HU-07: login → crear pregunta → el asistente la responde en la consulta siguiente", async () => {
  const login = await post("/api/admin/login", { usuario: "admin", clave: "clave-segura-123" });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);

  assert.strictEqual((await chat("cuando es la feria navideña del parque")).tipo, "sin_respuesta");

  const creada = await post("/api/admin/faqs", {
    pregunta: "¿Cuándo es la Feria Navideña del parque?", respuesta: "Del 15 al 24 de diciembre.",
    direccion: "Dirección de Desarrollo Comunitario", tags: "feria, navidad, navideña",
  }, cookie);
  assert.strictEqual(creada.status, 201);
  const { id } = await creada.json();

  const r = await chat("cuando es la feria navideña del parque");
  assert.strictEqual(r.tipo, "respuesta");
  assert.strictEqual(r.faqs[0].id, id);

  // Editar: el cambio también se ve de inmediato
  const editada = await fetch(`${base}/api/admin/faqs/${id}`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ pregunta: "¿Cuándo es la Feria Navideña del parque?", respuesta: "Del 18 al 24 de diciembre.", direccion: "Dirección de Desarrollo Comunitario", tags: "feria, navidad, navideña" }) });
  assert.strictEqual(editada.status, 200);
  assert.strictEqual((await chat("cuando es la feria navideña del parque")).faqs[0].respuesta, "Del 18 al 24 de diciembre.");
});

test("un cuerpo demasiado grande se rechaza", async () => {
  const r = await post("/api/chat", { consulta: "x".repeat(30000) });
  assert.strictEqual(r.status, 413);
});
