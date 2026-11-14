// Pruebas unitarias del repositorio de preguntas (usa una copia temporal de la base).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Repositorio, extraerEnlaces } = require("../lib/repositorio");

function repoTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faqs-"));
  const ruta = path.join(dir, "faqs.json");
  fs.writeFileSync(ruta, JSON.stringify([{ id: 1, categoria: "Consultas", pregunta: "Piscina", respuesta: "Calle 1", tags: [], direccion: "Corporación Deportes", enlaces: [], activo: true }]));
  return { ruta, repo: new Repositorio(ruta, { direcciones: ["Corporación Deportes", "Dirección Tránsito"] }) };
}
const NUEVA = { pregunta: "¿Cuándo es la feria?", respuesta: "En diciembre. Más info en www.penalolen.cl", direccion: "Dirección Tránsito", tags: "feria, navidad" };

test("crear asigna un ID nuevo, separa los tags, extrae enlaces y guarda en disco", () => {
  const { ruta, repo } = repoTemporal();
  const { faq } = repo.crear(NUEVA);
  assert.strictEqual(faq.id, 2);
  assert.deepStrictEqual(faq.tags, ["feria", "navidad"]);
  assert.deepStrictEqual(faq.enlaces, ["https://www.penalolen.cl"]);
  assert.strictEqual(JSON.parse(fs.readFileSync(ruta, "utf8")).length, 2);
});

test("actualizar cambia el registro sin cambiar su ID y avisa del cambio (para re-indexar)", () => {
  const { repo } = repoTemporal();
  let avisos = 0;
  repo.alCambiar = () => avisos++;
  const { faq } = repo.actualizar(1, { ...NUEVA, pregunta: "Piscina temperada" });
  assert.strictEqual(faq.id, 1);
  assert.strictEqual(repo.obtener(1).pregunta, "Piscina temperada");
  assert.strictEqual(avisos, 1);
});

test("valida campos obligatorios, largo máximo y dirección", () => {
  const { repo } = repoTemporal();
  assert.ok(repo.crear({ pregunta: "", respuesta: "x", direccion: "Dirección Tránsito" }).errores.length);
  assert.ok(repo.crear({ ...NUEVA, pregunta: "x".repeat(301) }).errores.length);
  assert.ok(repo.crear({ ...NUEVA, direccion: "Dirección Inventada" }).errores.length);
  assert.strictEqual(repo.listar().length, 1);    // nada inválido se guardó
});

test("actualizar un ID que no existe devuelve error", () => {
  const { repo } = repoTemporal();
  assert.ok(repo.actualizar(999, NUEVA).noEncontrado);
});

test("filtrar busca por texto o por N° de registro", () => {
  const { repo } = repoTemporal();
  repo.crear(NUEVA);
  assert.strictEqual(repo.filtrar("feria").length, 1);
  assert.strictEqual(repo.filtrar("2")[0].id, 2);
});

test("extraerEnlaces quita la puntuación final", () => {
  assert.deepStrictEqual(extraerEnlaces("Ver https://a.cl/x. Y www.b.cl:"), ["https://a.cl/x", "https://www.b.cl"]);
});
