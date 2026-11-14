// Repositorio de preguntas frecuentes: lee y guarda data/faqs.json.
//
// Es la única parte del sistema que sabe DÓNDE se guardan los datos (un archivo JSON). Si el
// municipio después quiere una base de datos real, se cambia solo este archivo (bajo acoplamiento).

const fs = require("fs");

const LIMITES = { pregunta: 300, respuesta: 3000, tags: 300, direccion: 120 };
const CATEGORIAS = ["Consultas", "Trámites", "Servicios", "Sin categoría"];
const URL_RE = /(https?:\/\/[^\s,;)<>"]+|www\.[^\s,;)<>"]+)/gi;

function extraerEnlaces(texto) {
  const enlaces = [];
  for (let url of String(texto).match(URL_RE) || []) {
    url = url.replace(/[.:]+$/, "");
    if (/^www\./i.test(url)) url = "https://" + url;
    if (!enlaces.includes(url)) enlaces.push(url);
  }
  return enlaces;
}

class Repositorio {
  /**
   * @param {string} ruta archivo JSON con las preguntas
   * @param {{ direcciones?: string[] }} opciones lista de direcciones válidas para el formulario
   */
  constructor(ruta, { direcciones = [] } = {}) {
    this.ruta = ruta;
    this.direcciones = direcciones;
    this.faqs = JSON.parse(fs.readFileSync(ruta, "utf8"));
    this.alCambiar = () => {};          // el servidor lo usa para re-indexar el buscador
  }

  listar() { return this.faqs; }

  obtener(id) { return this.faqs.find((f) => f.id === Number(id)) || null; }

  /** Busca por texto en pregunta, respuesta o dirección (para el panel de administración). */
  filtrar(texto = "") {
    const t = texto.trim().toLowerCase();
    if (!t) return this.faqs;
    if (/^\d+$/.test(t)) return this.faqs.filter((f) => f.id === Number(t));
    return this.faqs.filter((f) => `${f.pregunta} ${f.respuesta} ${f.direccion}`.toLowerCase().includes(t));
  }

  /** Valida los datos de un formulario. Devuelve la lista de errores (vacía si todo está bien). */
  validar(datos) {
    const errores = [];
    for (const campo of ["pregunta", "respuesta", "direccion"]) {
      const v = String(datos[campo] ?? "").trim();
      if (!v) errores.push(`El campo "${campo}" es obligatorio.`);
      else if (v.length > LIMITES[campo]) errores.push(`El campo "${campo}" supera los ${LIMITES[campo]} caracteres.`);
    }
    if (String(datos.tags ?? "").length > LIMITES.tags) errores.push(`Los tags superan los ${LIMITES.tags} caracteres.`);
    if (datos.categoria && !CATEGORIAS.includes(datos.categoria)) errores.push("Categoría no válida.");
    if (this.direcciones.length && datos.direccion && !this.direcciones.includes(String(datos.direccion).trim()))
      errores.push("Dirección no válida: elige una de la lista.");
    return errores;
  }

  /** Arma el registro a partir del formulario (limpia espacios, separa tags, extrae enlaces). */
  armar(datos, base = {}) {
    const respuesta = String(datos.respuesta).trim();
    const tags = Array.isArray(datos.tags) ? datos.tags : String(datos.tags ?? "").split(",");
    return {
      ...base,
      categoria: datos.categoria || base.categoria || "Consultas",
      subcategoria: base.subcategoria || "",
      pregunta: String(datos.pregunta).trim(),
      respuesta,
      tags: tags.map((t) => String(t).trim()).filter(Boolean),
      direccion: String(datos.direccion).trim(),
      enlaces: extraerEnlaces(respuesta),
      activo: datos.activo === undefined ? base.activo ?? true : Boolean(datos.activo),
    };
  }

  crear(datos) {
    const errores = this.validar(datos);
    if (errores.length) return { errores };
    const id = Math.max(0, ...this.faqs.map((f) => f.id)) + 1;
    const faq = { id, ...this.armar(datos) };
    this.faqs.push(faq);
    this.guardar();
    return { faq };
  }

  actualizar(id, datos) {
    const i = this.faqs.findIndex((f) => f.id === Number(id));
    if (i === -1) return { errores: ["No existe una pregunta con ese ID."], noEncontrado: true };
    const errores = this.validar(datos);
    if (errores.length) return { errores };
    this.faqs[i] = { ...this.armar(datos, this.faqs[i]), id: this.faqs[i].id };
    this.guardar();
    return { faq: this.faqs[i] };
  }

  /** Guarda en disco de forma segura: primero un archivo temporal y luego se reemplaza. */
  guardar() {
    const tmp = `${this.ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.faqs, null, 1), "utf8");
    fs.renameSync(tmp, this.ruta);
    this.alCambiar(this.faqs);
  }
}

module.exports = { Repositorio, CATEGORIAS, extraerEnlaces };
