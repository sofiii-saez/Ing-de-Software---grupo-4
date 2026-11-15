# Reporte de pruebas de aceptación — Con IA (gemini-2.5-flash, respaldo gemini-2.5-flash-lite)

Fecha: 15-11-2026, 2:33:19 p. m. · Base: 843 preguntas · Set: 40 consultas (30 de la base, 10 fuera de la base)

| Métrica | Meta (alcance) | Resultado | Estado |
|---|---|---|---|
| Exactitud | 100% de las respuestas entregadas corresponde al registro correcto | 89.3% (25 de 28) | ❌ No cumple |
| Cobertura | ≥ 80% de las consultas de la base recibe respuesta | 93.3% (28 de 30) | ✅ Cumple |
| Sin invención | 0 respuestas en las 10 consultas fuera de la base | 0 respuestas (10 de 10 derivadas) | ✅ Cumple |

## Detalle

| N° | HU | Consulta | Registro(s) esperado(s) | Registro entregado | Fuente | Resultado |
|---|---|---|---|---|---|---|
| 1 | HU-01 | como renuevo la licencia de conducir | 255, 287 | 255 | ia | ✅ Correcta |
| 2 | HU-01 | perdí mi carnet de manejar, como saco otro | 256 | 256 | ia | ✅ Correcta |
| 3 | HU-02 | que necesito para el subsidio del agua | 264 | 264 | ia | ✅ Correcta |
| 4 | HU-01 | como saco la ficha del registro social de hogares | 251 | 251 | ia | ✅ Correcta |
| 5 | HU-04 | a que hora atiende la oirs | 272, 273, 327 | 273 | ia | ✅ Correcta |
| 6 | HU-05 | cual es el link de la oirs digital | 270, 281, 326 | 281 | ia | ✅ Correcta |
| 7 | HU-04 | donde reciclo el aceite de cocina usado | 120 | 120 | ia | ✅ Correcta |
| 8 | HU-03 | que cosas no puedo echar en la compostera | 76 | 76 | ia | ✅ Correcta |
| 9 | HU-04 | hay un auto abandonado en mi pasaje, donde lo denuncio | 57 | 57 | ia-texto-oficial | ✅ Correcta |
| 10 | HU-04 | mis vecinos hacen mucha bulla, que puedo hacer | 62, 689 | 689 | ia-texto-oficial | ✅ Correcta |
| 11 | HU-04 | como pido que arreglen el foco de luz de mi calle | 299, 332, 589 | 589 | ia-texto-oficial | ✅ Correcta |
| 12 | HU-04 | como pido que tapen un hoyo en la calle | 194, 592 | 305 | ia | ❌ Registro equivocado |
| 13 | HU-01 | cuanto cuesta el permiso de circulacion | 788 | 788 | ia | ✅ Correcta |
| 14 | HU-05 | se puede pagar el permiso de circulacion por internet | 791 | 791 | ia | ✅ Correcta |
| 15 | HU-01 | como saco patente comercial para mi negocio | 195, 253, 557, 569, 572 | 253 | ia | ✅ Correcta |
| 16 | HU-01 | quiero cerrar mi patente, como lo hago | 265, 571 | 571 | ia | ✅ Correcta |
| 17 | HU-01 | como se si mi casa esta regularizada | 163 | 163 | ia-texto-oficial | ✅ Correcta |
| 18 | HU-04 | donde queda la piscina temperada | 3 | 3 | buscador | ✅ Correcta |
| 19 | HU-03 | donde me inscribo en un taller de deporte | 5 | 5 | ia | ✅ Correcta |
| 20 | HU-02 | que necesito para inscribirme en la biblioteca y pedir libros | 393 | 394 | buscador | ❌ Registro equivocado |
| 21 | HU-02 | requisitos del subsidio de arriendo para adultos mayores | 421, 770 | 421 | buscador | ✅ Correcta |
| 22 | HU-03 | en que banco abro la libreta de ahorro para la vivienda | 757 | 757 | ia | ✅ Correcta |
| 23 | HU-03 | pedir informacion por transparencia es gratis? | 488 | — | buscador | ❌ Sin respuesta (deriva) |
| 24 | HU-04 | donde estan los cesfam | 304 | 304 | ia | ✅ Correcta |
| 25 | HU-04 | cual es la direccion de la municipalidad | 303 | — | buscador | ❌ Sin respuesta (deriva) |
| 26 | HU-03 | que es el plan regulador comunal | 49, 50 | 160 | buscador | ❌ Registro equivocado |
| 27 | HU-03 | como entra mi hija a la escuela de ballet | 521, 537 | 537 | ia | ✅ Correcta |
| 28 | HU-03 | las capacitaciones de yunus tienen algun costo | 832 | 832 | buscador | ✅ Correcta |
| 29 | HU-03 | que es hepi crianza | 703 | 703 | buscador | ✅ Correcta |
| 30 | HU-02 | requisitos para postular al mejoramiento de vivienda ds27 | 429, 774 | 429 | buscador | ✅ Correcta |
| 31 | HU-06 | a cuanto esta el dolar hoy | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 32 | HU-06 | a que hora abre el mall plaza egaña | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 33 | HU-06 | dame una receta de empanadas de pino | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 34 | HU-06 | quien gano la eleccion presidencial | — (fuera de la base) | — | ia | ✅ Correcto: dice que no sabe y deriva |
| 35 | HU-06 | como cambio mi plan de celular | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 36 | HU-06 | cuanto salio el partido de colo colo | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 37 | HU-06 | cuanto cuesta la bencina esta semana | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 38 | HU-06 | como saco licencia de piloto de avion | — (fuera de la base) | — | ia | ✅ Correcto: dice que no sabe y deriva |
| 39 | HU-06 | en que universidad puedo estudiar medicina | — (fuera de la base) | — | buscador | ✅ Correcto: dice que no sabe y deriva |
| 40 | HU-06 | como pido un uber al aeropuerto | — (fuera de la base) | — | ia | ✅ Correcto: dice que no sabe y deriva |
