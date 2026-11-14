// Buscador de preguntas frecuentes (TF-IDF + similitud coseno), sin dependencias.
//
// Reemplaza a lib/reglas.js del repo MUNIA: allá el código filtraba el catálogo por perfil; acá el
// código elige las preguntas de la base más parecidas a lo que escribió el vecino. La IA (si está
// activa) solo puede elegir entre esos candidatos: "el modelo no puede recomendar lo que no ve".

// Palabras que no aportan para buscar (artículos, preposiciones, y palabras que aparecen en casi
// todas las preguntas de la base, como "Peñalolén" o "municipalidad").
const STOPWORDS = new Set(`
a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales
cualquier cuando cuanto cuantos de del desde donde dos durante e el ella ellas ellos en entre era es esa
esas ese eso esos esta estan estas este esto estos fue ha hace hacer hacen hay he hola la las le les lo
los mas me mi mis mucho muy necesito ni no nos nuestra nuestro o os otra otro para pero poco por porque
puede pueden puedo que quien quienes quiero se sea ser si sin sobre solo son su sus tambien te tengo
tiene tienen toda todo todos tu tus un una uno unos usted ustedes y ya yo
penalolen municipalidad municipal municipio comuna comunal favor gracias saber informacion
sacar saco obtener obtengo pedir pido solicitar solicito tramitar tramito hago hacer necesita debo
debe deben realizar realizo gustaria quisiera consultar consulta hoy semana ahora existe existen
ir voy vaya tengo tendria
`.split(/\s+/).filter(Boolean));

// Sinónimos: palabra que usa el vecino → palabras que usa la base para lo mismo.
// Se usan para AMPLIAR la consulta (se busca la palabra original + sus sinónimos), no para
// reemplazarla. Así una palabra con dos sentidos ("carnet" = cédula o licencia) trae candidatos de
// ambos y la IA elige el que corresponde. Se puede ampliar sin tocar el resto del código.
const SINONIMOS = {
  // documentos y vehículos
  carnet: ["cedula", "identidad", "licencia"], carne: ["cedula", "identidad", "licencia"],
  manejar: ["conducir", "licencia"], auto: ["vehiculo"], autos: ["vehiculo"], carro: ["vehiculo"],
  renuevo: ["renovar"], renovacion: ["renovar"],
  perdi: ["duplicado", "extravio"], perdida: ["duplicado", "extravio"], extravie: ["duplicado", "extravio"],
  // calles, luz y aseo
  hoyo: ["bache"], tapen: ["reparacion"], arreglen: ["reparacion"], arreglar: ["reparacion"],
  arreglo: ["reparacion"], reparar: ["reparacion"],
  luz: ["luminaria"], poste: ["luminaria"], foco: ["luminaria"],
  basura: ["aseo", "residuo"], escombros: ["escombro"], cachureos: ["voluminoso"],
  arbol: ["arbole", "poda"], ramas: ["poda"],
  // reciclaje
  reciclo: ["reciclar", "reciclaje"], echar: ["poner", "depositar"], botar: ["poner", "depositar"],
  // trámites y atención
  hora: ["horario"], atiende: ["atencion", "horario"], atienden: ["atencion", "horario"],
  inscribo: ["inscribir", "inscribirme", "inscripcion"], inscribirme: ["inscribir", "inscripcion"],
  gratis: ["gratuito", "costo"], gratuita: ["gratuito", "costo"],
  cerrar: ["termino", "cierre"], plata: ["pago"], pagar: ["pago"], cobro: ["pago", "costo"],
  negocio: ["patente", "comercial"], emprender: ["emprendimiento"],
  // vivienda y social
  arrendar: ["arriendo"], casa: ["vivienda"], depto: ["departamento", "vivienda"],
  ficha: ["registro", "social", "hogar"], rsh: ["registro", "social", "hogar"],
  bulla: ["ruido"],
  // otros
  perro: ["mascota"], gato: ["mascota"],
  remedios: ["medicamento", "farmacia"], consultorio: ["cesfam"], doctor: ["medico"],
  pega: ["empleo", "trabajo"], trabajo: ["empleo"], trabajar: ["empleo", "trabajo"],
};

/** Pasa a minúsculas, quita tildes y signos, y separa en palabras útiles (sin sinónimos). */
function normalizar(texto) {
  return palabras(texto).map(raiz);
}

function palabras(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p.length > 1 && !STOPWORDS.has(p));
}

/**
 * Palabras de la consulta del vecino, cada una con sus sinónimos: [["carnet","cedula","identidad","licencia"], ...]
 * Cada grupo cuenta como UNA palabra al medir cobertura.
 */
function terminosConsulta(texto) {
  return palabras(texto).map((p) => [...new Set([p, ...(SINONIMOS[p] || [])].map(raiz))]);
}

/** "Raíz" muy simple para que singular y plural coincidan (licencias → licencia). */
function raiz(p) {
  if (p.length > 5 && /[lrndzj]es$/.test(p)) return p.slice(0, -2);   // hogares → hogar, ciudades → ciudad
  if (p.length > 3 && p.endsWith("s")) return p.slice(0, -1);          // baches → bache, libros → libro
  return p;
}

class Buscador {
  /**
   * @param {Array<object>} faqs registros de data/faqs.json
   * @param {{ umbral?: number, coberturaMinima?: number, pesos?: object }} opciones
   *        umbral y coberturaMinima: cuándo el buscador responde solo (modo sin IA)
   *        pesos: cuántas veces cuenta la pregunta, los tags y la respuesta al indexar
   */
  constructor(faqs, { umbral = 0.35, coberturaMinima = 0.6, pesos = { pregunta: 3, tags: 2, respuesta: 1 } } = {}) {
    this.umbral = umbral;
    this.coberturaMinima = coberturaMinima;
    this.pesos = pesos;
    this.indexar(faqs);
  }

  /** (Re)construye el índice. Se llama de nuevo cuando un funcionario edita la base (HU-07). */
  indexar(faqs) {
    this.faqs = faqs.filter((f) => f.activo !== false);
    // La pregunta pesa más que los tags y la respuesta: es lo que mejor describe de qué trata el registro.
    const repetir = (lista, veces) => Array.from({ length: veces }, () => lista).flat();
    const docs = this.faqs.map((f) => [
      ...repetir(normalizar(f.pregunta), this.pesos.pregunta),
      ...repetir(normalizar((f.tags || []).join(" ")), this.pesos.tags),
      ...repetir(normalizar(f.respuesta), this.pesos.respuesta),
    ]);
    const df = new Map();
    for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length;
    this.idf = new Map([...df].map(([t, n]) => [t, Math.log((N + 1) / (n + 1)) + 1]));
    this.vectores = docs.map((d) => this.vector(d));
  }

  vector(terminos) {
    const tf = new Map();
    for (const t of terminos) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    let norma = 0;
    for (const [t, n] of tf) {
      const idf = this.idf.get(t);
      if (!idf) continue;                       // palabra que no existe en la base
      const peso = (1 + Math.log(n)) * idf;
      v.set(t, peso);
      norma += peso * peso;
    }
    norma = Math.sqrt(norma);
    if (norma) for (const [t, p] of v) v.set(t, p / norma);
    return v;
  }

  /**
   * Devuelve las k preguntas más parecidas a la consulta, de mayor a menor similitud (0 a 1).
   * @returns {Array<{ faq: object, puntaje: number, cobertura: number }>}
   */
  buscar(consulta, k = 5) {
    const grupos = terminosConsulta(consulta);
    const q = this.vector([...new Set(grupos.flat())]);
    if (q.size === 0) return [];
    const resultados = [];
    this.vectores.forEach((v, i) => {
      let s = 0;
      for (const [t, p] of q) { const pv = v.get(t); if (pv) s += p * pv; }
      if (s > 0) resultados.push({ faq: this.faqs[i], puntaje: Math.round(s * 1000) / 1000, cobertura: this.cobertura(grupos, v) });
    });
    return resultados.sort((a, b) => b.puntaje - a.puntaje).slice(0, k);
  }

  /** Fracción de las palabras de la consulta (o algún sinónimo) que aparecen en el registro (0 a 1). */
  cobertura(grupos, vectorRegistro) {
    if (!grupos.length) return 0;
    const cubiertos = grupos.filter((g) => g.some((t) => vectorRegistro.has(t))).length;
    return Math.round((cubiertos / grupos.length) * 100) / 100;
  }

  /**
   * ¿El mejor resultado es lo bastante parecido como para responder SIN ayuda de la IA?
   * Exige similitud y que la mayoría de las palabras de la consulta estén en el registro. Es un
   * criterio conservador: preferimos decir "no sé" antes que entregar un registro equivocado.
   */
  hayRespuesta(resultados) {
    const r = resultados[0];
    return Boolean(r) && r.puntaje >= this.umbral && r.cobertura >= this.coberturaMinima;
  }
}

module.exports = { Buscador, normalizar, terminosConsulta };
