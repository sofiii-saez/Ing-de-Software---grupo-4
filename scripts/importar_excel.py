"""
Importa la base oficial de preguntas frecuentes (Excel de la Municipalidad) a data/faqs.json.

Uso:
    pip install openpyxl
    python scripts/importar_excel.py data/preguntas_frecuentes_municipalidad.xlsx

Qué hace (y deja anotado en data/reporte_limpieza.md):
  1. Lee la hoja "Revisdas" (843 registros). Las hojas ocultas no se usan, salvo "Hoja1",
     que trae la lista oficial de direcciones municipales (data/direcciones.json).
  2. Limpia espacios y saltos de línea sobrantes.
  3. Normaliza la categoría (consultas/Consultas -> Consultas, tramites/trámites/Trámites -> Trámites...).
  4. Corrige los registros de Corporación Yunus, que vienen con las columnas corridas:
     la respuesta está en la columna de tags y la subcategoría en la de descripción.
  5. Extrae los enlaces (http/https/www) de cada respuesta, para mostrarlos como link (HU-05).
  6. Detecta preguntas repetidas. NO las borra (la base es del municipio): solo las informa.

El contenido de las respuestas no se modifica: el asistente muestra el texto oficial tal cual.
"""
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
HOJA = "Revisdas"
URL_RE = re.compile(r"(https?://[^\s,;)<>\"]+|www\.[^\s,;)<>\"]+)", re.IGNORECASE)


def sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def limpiar(texto):
    if texto is None:
        return ""
    texto = str(texto).replace("\r", "\n")
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\n\s*\n+", "\n", texto)
    return texto.strip()


def normalizar_categoria(valor):
    v = sin_tildes(limpiar(valor)).lower()
    if v.startswith("consulta"):
        return "Consultas"
    if v.startswith("tramite"):
        return "Trámites"
    if v.startswith("servicio"):
        return "Servicios"
    return "Sin categoría"


def extraer_enlaces(texto):
    enlaces = []
    for url in URL_RE.findall(texto):
        url = url.rstrip(".:")
        if url.lower().startswith("www."):
            url = "https://" + url
        if url not in enlaces:
            enlaces.append(url)
    return enlaces


def main(ruta_excel):
    wb = openpyxl.load_workbook(ruta_excel, read_only=True, data_only=True)
    filas = list(wb[HOJA].iter_rows(values_only=True))
    encabezado, datos = filas[0], [f for f in filas[1:] if f[0] is not None]
    col = {nombre: i for i, nombre in enumerate(encabezado) if nombre}

    faqs, avisos = [], defaultdict(list)
    for f in datos:
        id_ = int(f[col["preguntaFrecuenteID"]])
        categoria_original = f[col["categoriaPreguntaFrecuente"]]
        pregunta = limpiar(f[col["nombrePreguntaFrecuente"]])
        respuesta = limpiar(f[col["descripcionPreguntaFrecuente"]])
        tags = limpiar(f[col["tagPreguntaFrecuente"]])
        direccion = limpiar(f[col["Direccion"]])
        subcategoria = ""

        # Registros de Yunus con columnas corridas: descripción = subcategoría corta, tags = respuesta.
        if direccion == "Corporación Yunus" and len(respuesta) < 40 and len(tags) > len(respuesta):
            subcategoria, respuesta, tags = respuesta, tags, ""
            avisos["columnas_corridas"].append(id_)

        if categoria_original is None:
            avisos["sin_categoria"].append(id_)

        faqs.append({
            "id": id_,
            "categoria": normalizar_categoria(categoria_original),
            "subcategoria": subcategoria,
            "pregunta": pregunta,
            "respuesta": respuesta,
            "tags": [t.strip() for t in tags.split(",") if t.strip()],
            "direccion": direccion,
            "enlaces": extraer_enlaces(respuesta),
            "activo": True,
        })

    # Preguntas repetidas (mismo texto, sin importar mayúsculas/tildes/signos)
    grupos = defaultdict(list)
    for faq in faqs:
        clave = re.sub(r"[^a-z0-9 ]", "", sin_tildes(faq["pregunta"]).lower()).strip()
        grupos[clave].append(faq["id"])
    repetidas = [ids for ids in grupos.values() if len(ids) > 1]

    # Direcciones: las que usa la base + las de la hoja oculta "Hoja1". Se omiten las de Hoja1 que son
    # otro nombre de una que ya está en la base, y la fila "Prueba".
    alias_hoja1 = {"Prueba", "Dirección Obras", "Dirección Vivienda", "Corporación Desarrollo Económico YUNUS"}
    direcciones = set(f["direccion"] for f in faqs if f["direccion"])
    if "Hoja1" in wb.sheetnames:
        for fila in list(wb["Hoja1"].iter_rows(values_only=True))[1:]:
            if fila and fila[0] and limpiar(fila[0]) not in alias_hoja1:
                direcciones.add(limpiar(fila[0]))

    (RAIZ / "data" / "faqs.json").write_text(json.dumps(faqs, ensure_ascii=False, indent=1), encoding="utf-8")
    (RAIZ / "data" / "direcciones.json").write_text(
        json.dumps(sorted(direcciones), ensure_ascii=False, indent=1), encoding="utf-8")

    con_enlace = sum(1 for f in faqs if f["enlaces"])
    categorias = defaultdict(int)
    for f in faqs:
        categorias[f["categoria"]] += 1
    reporte = [
        f"# Reporte de limpieza de la base ({date.today().isoformat()})",
        "",
        f"- Archivo: `{Path(ruta_excel).name}`, hoja `{HOJA}`",
        f"- Registros importados: **{len(faqs)}**",
        f"- Categorías normalizadas: " + ", ".join(f"{k} ({v})" for k, v in sorted(categorias.items())),
        f"- Registros sin categoría en el Excel: {len(avisos['sin_categoria'])} → IDs {avisos['sin_categoria']}",
        f"- Registros con columnas corridas (Corporación Yunus), corregidos al importar: "
        f"{len(avisos['columnas_corridas'])} → IDs {avisos['columnas_corridas'][0]}–{avisos['columnas_corridas'][-1]}"
        if avisos["columnas_corridas"] else "- Registros con columnas corridas: 0",
        f"- Registros con al menos un enlace (http/www) en la respuesta: {con_enlace} ({con_enlace * 100 // len(faqs)}%)",
        f"- Grupos de preguntas con el mismo texto: {len(repetidas)} "
        f"({sum(len(g) for g in repetidas)} registros). No se eliminaron: se informan al municipio para que decida.",
        "",
        "## Preguntas repetidas (IDs)",
        "",
    ] + [f"- {', '.join(map(str, g))}: {next(f['pregunta'] for f in faqs if f['id'] == g[0])}" for g in repetidas]
    (RAIZ / "data" / "reporte_limpieza.md").write_text("\n".join(reporte) + "\n", encoding="utf-8")

    print(f"OK: {len(faqs)} preguntas -> data/faqs.json · {len(direcciones)} direcciones -> data/direcciones.json")
    print("Detalle en data/reporte_limpieza.md")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else RAIZ / "data" / "preguntas_frecuentes_municipalidad.xlsx")
