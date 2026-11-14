// Panel de administración (HU-07): login, búsqueda, crear y editar preguntas.
const $ = (s) => document.querySelector(s);
const vistas = ["#vista-login", "#vista-lista", "#vista-form"];
let editando = null;      // id del registro en edición (null = nuevo)
let faqsVisibles = [];

function mostrar(vista) {
  vistas.forEach((v) => ($(v).hidden = v !== vista));
  $("#salir").hidden = vista === "#vista-login";
}

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== "/api/admin/login") { mostrar("#vista-login"); throw new Error("sesión"); }
  return { ok: res.ok, status: res.status, datos };
}

function opcion(valor) { const o = document.createElement("option"); o.value = o.textContent = valor; return o; }

async function cargarOpciones() {
  const { datos } = await api("/api/admin/opciones");
  $("#f-direccion").replaceChildren(opcion(""), ...datos.direcciones.map(opcion));
  $("#f-categoria").replaceChildren(...datos.categorias.map(opcion));
}

async function listar() {
  const q = encodeURIComponent($("#buscar").value);
  const { datos } = await api(`/api/admin/faqs?q=${q}`);
  faqsVisibles = datos.faqs;
  $("#total").textContent = `${datos.total} preguntas${datos.total > datos.faqs.length ? ` (se muestran las primeras ${datos.faqs.length})` : ""}`;
  $("#filas").replaceChildren(...datos.faqs.map((f) => {
    const tr = document.createElement("tr");
    for (const [texto, clase] of [[f.id], [f.pregunta + (f.activo === false ? " (inactiva)" : "")], [f.direccion, "col-dir"]]) {
      const td = document.createElement("td");
      td.textContent = texto;
      if (clase) td.className = clase;
      tr.append(td);
    }
    tr.tabIndex = 0;
    tr.addEventListener("click", () => abrir(f));
    tr.addEventListener("keydown", (e) => e.key === "Enter" && abrir(f));
    return tr;
  }));
}

function abrir(faq) {
  editando = faq ? faq.id : null;
  $("#titulo-form").textContent = faq ? `Editar registro N° ${faq.id}` : "Nueva pregunta";
  $("#f-pregunta").value = faq?.pregunta || "";
  $("#f-respuesta").value = faq?.respuesta || "";
  $("#f-direccion").value = faq?.direccion || "";
  $("#f-categoria").value = faq?.categoria || "Consultas";
  $("#f-tags").value = (faq?.tags || []).join(", ");
  $("#f-activo").checked = faq ? faq.activo !== false : true;
  $("#msg-form").textContent = "";
  mostrar("#vista-form");
  $("#f-pregunta").focus();
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#error-login").textContent = "";
  const { ok, datos } = await api("/api/admin/login", {
    method: "POST", body: JSON.stringify({ usuario: $("#usuario").value, clave: $("#clave").value }),
  });
  $("#clave").value = "";
  if (!ok) return ($("#error-login").textContent = datos.error || "No se pudo iniciar sesión.");
  await entrar();
});

$("#form-faq").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cuerpo = {
    pregunta: $("#f-pregunta").value, respuesta: $("#f-respuesta").value, direccion: $("#f-direccion").value,
    categoria: $("#f-categoria").value, tags: $("#f-tags").value, activo: $("#f-activo").checked,
  };
  const { ok, datos } = await api(editando ? `/api/admin/faqs/${editando}` : "/api/admin/faqs", {
    method: editando ? "PUT" : "POST", body: JSON.stringify(cuerpo),
  });
  const msg = $("#msg-form");
  if (!ok) { msg.className = "error"; msg.textContent = (datos.errores || [datos.error]).join(" "); return; }
  editando = datos.id;
  $("#titulo-form").textContent = `Editar registro N° ${datos.id}`;
  msg.className = "ok";
  msg.textContent = `✅ Guardado (registro N° ${datos.id}). El asistente ya usa la nueva versión.`;
});

let espera;
$("#buscar").addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(listar, 250); });
$("#nueva").addEventListener("click", () => abrir(null));
$("#cancelar").addEventListener("click", async () => { mostrar("#vista-lista"); await listar(); });
$("#salir").addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); mostrar("#vista-login"); });

async function entrar() {
  await cargarOpciones();
  await listar();
  mostrar("#vista-lista");
}

(async () => {
  const { datos } = await api("/api/admin/sesion");
  if (datos.usuario) await entrar(); else mostrar("#vista-login");
})();
