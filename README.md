# Asistente Virtual de Trámites y Servicios Municipales · Peñalolén

Prototipo web de un asistente conversacional que responde consultas de vecinos y vecinas sobre trámites, requisitos, servicios y beneficios municipales, usando **solo** la base oficial de 843 preguntas frecuentes entregada por la Municipalidad de Peñalolén.

Proyecto semestral · Ingeniería de Software (TICS331) · UAI · 2026
Equipo: Constanza Lucero, Nicolás Navarrete, Fernanda Quirós y Sofía Sáez.

> Basado en la arquitectura del taller **MUNIA hands-on** ([afcarvallo/munia-hands-on](https://github.com/afcarvallo/munia-hands-on), licencia MIT, ver `LICENSE-MUNIA`): servidor Node sin dependencias, conexión a una API de IA compatible con OpenAI y la idea de que *el modelo no puede recomendar lo que no ve*.

---

## Qué hace (historias de usuario del alcance v1.2)

| HU | Qué hace el sistema |
|---|---|
| HU-01, HU-02, HU-03 | El vecino escribe su pregunta con sus palabras y recibe la respuesta oficial del registro correspondiente |
| HU-04 | Cada respuesta muestra la **Dirección responsable** y el **N° de registro** (trazabilidad) |
| HU-05 | Si el registro trae un enlace oficial, se muestra como link y botón. Si no, se indica a qué Dirección acudir |
| HU-06 | Si no hay información, lo dice (sin inventar) y deriva a la OIRS digital/presencial con registros oficiales |
| HU-07 | Panel de administración con usuario y contraseña para agregar y editar preguntas. El cambio se ve en la consulta siguiente |

## Cómo funciona

```
Vecino ──► Chat web (public/) ──► POST /api/chat ──► Asistente (lib/asistente.js)
                                                      │
                     1. ¿trae RUT, correo o teléfono? → aviso, no se procesa
                     2. Buscador por palabras (lib/buscador.js) → 10 candidatos de la base
                     3. Gemini recibe el ÍNDICE de las 843 preguntas (solo títulos) + el texto
                        completo de los 10 candidatos. Elige en TODO el índice los registros que
                        responden (máx. 3) y redacta la respuesta solo con su texto. Si eligió uno
                        que no estaba entre los candidatos, se le manda su texto en un 2° paso.
                     4. Si ninguno responde → "no tengo la información" + OIRS (HU-06)
                     5. Verificación: cada número, enlace y correo de la respuesta debe estar en
                        los registros elegidos; si no, se muestra el texto oficial
                     6. Si Gemini falla o no hay API key → responde el buscador (solo si está seguro)
                                                      │
                     Respuesta + "Fuente: Dirección · Registro N°" + "Ver texto oficial"
```

**¿Por qué el índice completo?** El buscador funciona por palabras: si el vecino usa una palabra distinta a la de la base (ej.: "carnet" en vez de "cédula de identidad"), puede no traer el registro correcto. Como Gemini ve los títulos de todas las preguntas, puede encontrarlo igual por el significado. El índice pesa ~20.000 tokens por consulta, dentro del límite gratuito de Gemini.

## Estructura

```
server.js              Servidor web y API (rutas públicas y del panel)
lib/buscador.js        Búsqueda TF-IDF con sinónimos y plurales
lib/asistente.js       Lógica de decisión (buscador + IA + validaciones)
lib/prompt.js          Instrucciones para la IA
lib/llm.js             Conexión con Gemini (o cualquier API compatible con OpenAI)
lib/repositorio.js     Lectura/escritura de data/faqs.json (crear, editar, validar)
lib/auth.js            Login del panel: hash scrypt, sesiones, bloqueo por intentos
public/                Chat del vecino (index.html) y panel (admin.html). Tipografía Atkinson Hyperlegible Next (OFL, public/fonts/OFL.txt)
data/faqs.json         Base de 843 preguntas, limpia (generada desde el Excel)
data/reporte_limpieza.md  Problemas encontrados en el Excel (para informar al municipio)
data/temas.json        Temas de la portada y sus preguntas frecuentes (respuesta oficial directa, sin IA)
scripts/importar_excel.py Importa el Excel → data/faqs.json
scripts/crear-admin.js    Crea el usuario administrador en .env
scripts/evaluar.js        Ejecuta el set de 40 consultas y genera el reporte de aceptación
pruebas/set_aceptacion.json  Las 40 consultas de prueba del alcance
test/                  Pruebas unitarias y de integración (node --test)
```

---

## Instalación paso a paso

**Requisitos:** [Node.js](https://nodejs.org) 18 o superior (recomendado 22 LTS). No hay que instalar paquetes (`npm install` no es necesario).

1. **Abrir la carpeta** del proyecto en VS Code y abrir una terminal (Terminal → New Terminal).
2. **Crear el archivo `.env`** a partir del ejemplo:
   - Mac/Linux: `cp .env.example .env`
   - Windows (PowerShell): `copy .env.example .env`
3. **(Opcional) Pegar la API key de Gemini** en `.env`, en la línea `API_KEY=`. Se crea gratis en [Google AI Studio](https://aistudio.google.com) → Claves de API, sin configurar facturación. Sin key, el asistente funciona solo con el buscador.
4. **Crear el administrador del panel:**
   ```bash
   npm run crear-admin
   ```
   Pide un usuario y una contraseña (mínimo 10 caracteres) y guarda en `.env` solo el hash.
5. **Iniciar:**
   ```bash
   npm start
   ```
   - Chat: <http://localhost:3000>
   - Panel: <http://localhost:3000/admin>

## Pruebas

```bash
npm test              # 40 pruebas unitarias y de integración (no usan internet ni la API key)
npm run evaluar       # set de aceptación de 40 consultas, modo sin IA → pruebas/reporte_aceptacion_sin_ia.md
npm run evaluar:ia    # mismo set, con Gemini → pruebas/reporte_aceptacion_con_ia.md (demora ~10 min; si se acaba la cuota, se retoma otro día)
```

> **Ojo con el plan gratuito de Gemini:** Gemini 2.5 Flash permite ~5 consultas por minuto y ~20 por día por proyecto (revisar en AI Studio → Límite de frecuencia). `evaluar:ia` espera 13 s entre consultas y, si se acaba el límite o el modelo está saturado, usa `MODEL_RESPALDO`. Para ver qué modelos acepta tu key: `npm run modelos`.

## Actualizar la base desde un Excel nuevo

```bash
pip install openpyxl
python scripts/importar_excel.py ruta/al/excel.xlsx
```

Ojo: esto **reemplaza** `data/faqs.json`, incluidos los cambios hechos desde el panel.

## Seguridad y datos

- Credenciales y API key solo en `.env`, que está en `.gitignore` (**nunca se sube a GitHub**).
- Contraseña guardada como hash scrypt con sal. Sesión con cookie `HttpOnly` + `SameSite=Strict` que vence a las 2 h. Bloqueo de 15 min tras 5 intentos fallidos.
- El asistente no pide datos personales, muestra un aviso y rechaza consultas que traen RUT, correo o celular. Esas consultas no se envían a la IA.
- El servidor **no guarda** el texto de las consultas. Solo registra en consola el tipo de respuesta y el N° de registro.
- Cabeceras de seguridad (CSP, X-Frame-Options, nosniff). Todo el texto se muestra con `textContent` (sin inyección de HTML).
