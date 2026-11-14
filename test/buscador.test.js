// Pruebas unitarias del buscador.   node --test test/buscador.test.js
const test = require("node:test");
const assert = require("node:assert");
const { Buscador, normalizar, terminosConsulta } = require("../lib/buscador");
const FAQS = require("../data/faqs.json");

const buscador = new Buscador(FAQS);
const ids = (consulta, k = 5) => buscador.buscar(consulta, k).map((r) => r.faq.id);

test("normalizar quita tildes, mayúsculas, signos y palabras vacías", () => {
  assert.deepStrictEqual(normalizar("¿Dónde queda la PISCINA de Peñalolén?"), ["queda", "piscina"]);
});

test("la consulta se amplía con sinónimos sin perder la palabra original", () => {
  assert.deepStrictEqual(terminosConsulta("carnet de manejar"),
    [["carnet", "cedula", "identidad", "licencia"], ["manejar", "conducir", "licencia"]]);
});

test("una palabra con dos sentidos trae candidatos de ambos: 'carnet' = cédula o licencia", () => {
  const encontrados = ids("donde puedo ir a renovar mi carnet", 10);
  assert.ok(encontrados.includes(259), "debe traer la renovación de cédula de identidad");
  assert.ok(encontrados.includes(255) || encontrados.includes(314), "debe traer la renovación de licencia");
});

test("singular y plural se tratan igual", () => {
  assert.deepStrictEqual(normalizar("baches"), normalizar("bache"));
  assert.deepStrictEqual(normalizar("hogares"), ["hogar"]);
});

test("encuentra una pregunta escrita con otras palabras", () => {
  assert.strictEqual(ids("donde queda la piscina temperada")[0], 3);
  assert.strictEqual(ids("cuanto cuesta el permiso de circulacion")[0], 788);
});

test("los resultados vienen ordenados de mayor a menor puntaje", () => {
  const r = buscador.buscar("subsidio de vivienda", 8);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].puntaje >= r[i].puntaje);
});

test("una consulta sin palabras de la base no trae resultados", () => {
  assert.deepStrictEqual(buscador.buscar("uber aeropuerto"), []);
  assert.deepStrictEqual(buscador.buscar("¿¿??"), []);
});

test("hayRespuesta es conservador: no responde temas que no están en la base", () => {
  assert.strictEqual(buscador.hayRespuesta(buscador.buscar("cuanto cuesta la bencina esta semana")), false);
  assert.strictEqual(buscador.hayRespuesta(buscador.buscar("como saco licencia de piloto de avion")), false);
  assert.strictEqual(buscador.hayRespuesta(buscador.buscar("donde queda la piscina temperada")), true);
});

test("las preguntas inactivas no se buscan", () => {
  const b = new Buscador([{ id: 1, pregunta: "Piscina", respuesta: "x", tags: [], activo: false },
                          { id: 2, pregunta: "Biblioteca", respuesta: "y", tags: [] }]);
  assert.deepStrictEqual(b.buscar("piscina"), []);
});

test("re-indexar incorpora preguntas nuevas", () => {
  const b = new Buscador([{ id: 1, pregunta: "Biblioteca", respuesta: "y", tags: [] }]);
  b.indexar([...b.faqs, { id: 2, pregunta: "¿Cuándo es la feria navideña?", respuesta: "En diciembre", tags: ["feria"] }]);
  assert.strictEqual(b.buscar("feria navideña")[0].faq.id, 2);
});
