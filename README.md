# Actualización v1.5.3 — Corrección de importación, inicio limpio y Excel (21/10/2026)

**Publicado en GitHub:** el inicio de VotaComunidad ya **no recupera la última sesión del almacenamiento del navegador**. Entrar en la URL raíz muestra las opciones «Crear sesión» y «Participar». Un enlace que contiene `?s=CÓDIGO` abre expresamente esa sesión y permite recargar durante una reunión. Pulsar «Inicio» elimina el código de la URL y del campo de entrada.

**Importación corregida:** la operación se bloquea mientras se procesa para impedir dobles envíos y mensajes contradictorios; solo se limpia el campo tras confirmar el guardado. Si está vacío se muestra un aviso específico. Se pueden importar directamente archivos **.xlsx** (primera hoja, mediante ExcelJS) o **.csv** (con cabeceras `vivienda` o `portal;planta;puerta`), o escribir una vivienda por línea. Las plantas numéricas se normalizan como `4º`.

**Exportación Excel completa:** si aparece el aviso «Falta ejecutar el SQL 07», la web está conectada pero la función `export_session_details` aún no está disponible en el proyecto Supabase. Abre [07_exportacion_excel_detallada.sql](07_exportacion_excel_detallada.sql), copia **Raw** y ejecútalo desde SQL Editor. Espera `excel_export_ready = true`. Si ya funcionó pero sigue el aviso, ejecuta `NOTIFY pgrst, 'reload schema';` y recarga la web. No se puede exportar el detalle de votos por vivienda sin esa función protegida.

**Limitación:** la actualización del código se ha verificado en GitHub, pero no equivale a una prueba completa de lectura/escritura con las credenciales de tu Supabase. Tampoco ejecuta scripts SQL automáticamente ni instala la Edge Function de eliminación.

---

# Actualización v1.5 — Excel con detalle por vivienda (21/10/2026)

**Requiere una acción en Supabase:** ejecuta [07_exportacion_excel_detallada.sql](07_exportacion_excel_detallada.sql) desde SQL Editor. Es una migración que únicamente añade una función de lectura, sin borrar datos. El resultado debería mostrar `excel_export_ready = true`. No necesitas repetir los SQL del 01 al 06.

En el panel del organizador aparece **Exportar Excel completo (.xlsx)**:

- **Resumen:** una fila por pregunta, con sesión, enunciado, estado y **una columna para cada opción** (Sí / No / Abstención u otras), más Total votos y Sin votar.
- **Pregunta 1, Pregunta 2, ...:** una hoja por pregunta con las viviendas que eligieron cada respuesta, agrupadas en columnas. Incluye otra columna **Sin votar**; es diferente de una abstención explícita.
- El censo y los votos se leen desde el servidor en el momento de exportar, no desde una captura antigua del navegador.
- **Seguridad:** la nueva función SQL comprueba que `auth.uid()` sea el propietario de la sesión. Los participantes no tienen acceso al desglose por vivienda.
- El generador ExcelJS se descarga bajo demanda de jsDelivr, versión 4.4.0. Se necesita conexión para iniciar la exportación.
- Tras generar el archivo, el organizador debe verificar que se descargó y guardó. Antes del borrado se vuelve a comparar el estado de la sesión con la exportación: si hubo cambios, es obligatorio exportar otra vez.

**Privacidad:** el XLSX revela qué ha votado cada vivienda. Ya no puede considerarse anónimo frente al organizador; debe custodiarse de forma privada y no compartirse públicamente. El borrado de Supabase no elimina las copias descargadas ni sus backups. Consulta [PRIVACIDAD.md](PRIVACIDAD.md).

**Nota:** el flujo de eliminación al finalizar reunión requiere desplegar la Edge Function de `PRIVACIDAD.md`; no se ha validado todavía en una sesión real. El código se ha publicado en GitHub, pero la migración SQL 07 debe ejecutarse manualmente en tu proyecto Supabase.

---

# VotaComunidad v1.4 — corrección de votaciones y rendimiento (21/10/2026)

**INSTALACIÓN OBLIGATORIA EN SUPABASE:** Ejecuta el archivo [06_reparacion_y_rendimiento.sql](06_reparacion_y_rendimiento.sql) completo desde **SQL Editor → New → Run**. Su resultado debe mostrar `participant_ready`, `organizer_ready`, `housing_ready` y `voting_ready` como `true`. Este script incluye la reparación de la migración 05, por lo que **no hace falta ejecutar también 05**. No elimina sesiones ni datos. **Los cambios del HTML/JS en GitHub no instalan por sí solos las funciones de Supabase.**

El organizador ahora **solo importa el censo (CSV exportado desde Excel) o añade viviendas en el campo de texto**, y ve qué participantes están inscritos, qué viviendas han elegido y cuáles quedan sin asignar. Los participantes seleccionan sus viviendas libres desde el móvil; una operación atómica impide que dos personas reclamen la misma. El identificador mostrado es anónimo y **no verifica propiedad ni delegaciones**.

La pregunta se crea en estado Pendiente; al pulsar **Abrir votación** pasa a Abierta y los participantes la reciben mediante la sincronización periódica. Esta versión usa una **consulta RPC cada 3 segundos por dispositivo**, frente a varias consultas encadenadas; el contenido solo se reconstruye cuando hay cambios. La consulta se pausa cuando la pestaña no está visible y se fuerza al regresar.

**Prueba recomendada:** 1) ejecuta SQL 06; 2) vuelve a cargar la web; 3) desde el organizador crea sesión e importa viviendas; 4) entra desde otro navegador/móvil, busca y selecciona una vivienda, guárdala; 5) abre una pregunta; 6) comprueba que aparece en el móvil y que los votos incrementan el total; 7) comprueba con un tercer navegador que la vivienda está bloqueada. Si la aplicación indica «Falta instalar 06» tras instalarlo, vuelve a ejecutar `NOTIFY pgrst, 'reload schema';` en SQL Editor.

**Importante:** código publicado y sintaxis/elementos verificados, pero la prueba integrada contra tu Supabase requiere que ejecutes SQL 06 y la hagas desde dispositivos reales. La función «Finalizar y eliminar» requiere aparte desplegar la Edge Function del documento [PRIVACIDAD.md](PRIVACIDAD.md). No se ha comprobado todavía el borrado real. La exportación actual es CSV compatible con Excel, no un fichero .xlsx nativo.

---

## Actualización v1.3 — selección de viviendas y apertura de votaciones (21/10/2026)

**Obligatorio para que funcionen las pantallas nuevas:** ejecutar [05_seleccion_viviendas_y_apertura.sql](05_seleccion_viviendas_y_apertura.sql) en el **SQL Editor** del proyecto de Supabase. No repetir los tres scripts iniciales; el archivo 05 es una migración aditiva que no elimina datos. **GitHub no ejecuta automáticamente migraciones SQL.**

- Al unirse por código, el participante ve todas las viviendas: **Disponible**, **Tu vivienda** o **Ya seleccionada**. Puede marcar varias y pulsar **Guardar viviendas seleccionadas**.
- El bloqueo de reclamaciones es **atómico en Supabase**: si dos personas reclaman la misma vivienda, solo la primera operación confirmada puede asignarla. La segunda recibe error y debe actualizar.
- Una persona que ya haya emitido algún voto no puede cambiar sus viviendas. Se puede registrar una representación antes o durante las preguntas abiertas, si esa persona aún no ha votado.
- El organizador ve una lista de participantes registrados (identificadores anónimos de 8 caracteres), viviendas de cada uno y viviendas aún sin asignar. «Registrados» **no** significa que estén conectados en ese preciso momento.
- Se elimina el bloqueo anterior que impedía abrir preguntas cuando aún no había viviendas asignadas. Los participantes deben elegir vivienda antes de enviar su respuesta. La pregunta abierta aparece normalmente en unos 2,5 segundos.
- El mensaje de error al abrir/cerrar votaciones aparece ahora de forma visible en la pantalla.

**Limitación de seguridad:** esto evita duplicidades pero **no verifica que una persona sea propietaria ni esté autorizada** para representar las viviendas que selecciona. Un usuario que tenga el código puede reclamar viviendas libres. El organizador debe contrastar la representación fuera de la app; no usar en acuerdos jurídicamente vinculantes sin controles adicionales.

**Privacidad/borrado:** el botón de finalización sigue necesitando ejecutar [privacy_purge.sql](privacy_purge.sql) y desplegar la Edge Function descrita en [PRIVACIDAD.md](PRIVACIDAD.md). No se ha desplegado ni verificado automáticamente.

> **Actualización de privacidad (21/10/2026):** incorporado el flujo «exportar CSV → confirmar → solicitar borrado», la función SQL y la Edge Function de limpieza de usuarios anónimos. **Todavía no está desplegado ni probado en Supabase.** Es necesario instalar primero schema.sql y upgrade_viviendas.sql (no están en este repositorio) y seguir [PRIVACIDAD.md](PRIVACIDAD.md). No uses el borrado para datos reales sin verificar toda la instalación. La eliminación de copias de seguridad no es inmediata.

# VotaComunidad

Web responsive para organizar votaciones desde cualquier móvil usando **HTML + CSS + JavaScript, GitHub Pages y Supabase**. No requiere servidor propio.

## Puesta en marcha (10–15 minutos)

1. En [Supabase](https://supabase.com/), crea un proyecto. En **Authentication → Providers → Anonymous Sign-ins**, activa el inicio de sesión anónimo.
2. Abre **SQL Editor** y ejecuta el contenido completo de `schema.sql` (primera instalación, una sola vez). Supabase aplica las políticas **Row Level Security** de ese script.
3. Abre **Project Settings → API Keys** (o **Connect** según la versión) y copia la **Project URL** y la clave pública **anon / publishable** en `config.js`. **Nunca copies una clave secret o service_role** a archivos públicos.
4. Sube los archivos `index.html`, `styles.css`, `app.js` y `config.js` a un repositorio público de GitHub. NO hace falta subir `schema.sql` para el funcionamiento (puedes conservarlo en el repo como documentación).
5. En GitHub: **Settings → Pages → Deploy from a branch → main → /(root)**. Abre la URL que GitHub te muestre (HTTPS obligatorio para compartir/copy).
6. Crea una sesión desde un navegador. Comparte el enlace o el código de 8 caracteres. Desde otros móviles, entra, abre una pregunta y comprueba los votos.

En desarrollo local, puedes abrir `index.html` con un servidor estático como `python -m http.server 8080` y visitar `http://localhost:8080`.

## Funcionalidades
- Organizador: sesión con código, agenda de preguntas, apertura y cierre de cada votación, resultados por opción, total de asistentes registrados y exportación CSV.
- Participantes: entrada por código o enlace, elección y modificación de voto **mientras la pregunta esté abierta**.
- Respuestas por defecto: Sí, No y Abstención. También preguntas con 2–8 opciones personalizadas.
- Actualización automática cada 2,5 s mediante consultas HTTPS.
- Tema claro/oscuro, diseño para móvil, sin instalación ni registro nominal.
- Las políticas de Supabase limitan lectura y escritura; los participantes no pueden ver votos individuales ajenos.

## Límites y consideraciones importantes
- **Pensado para consultas informales**, no para votaciones legales o vinculantes de comunidades de propietarios sin controles adicionales.
- Una identidad anónima se mantiene en el navegador; **una persona puede emitir votos adicionales usando otro navegador/dispositivo o limpiando datos**. No hay verificación de propietario, vivienda, poderes, coeficientes de participación ni quórum legal. Para juntas formales hace falta un censo de votantes, invitaciones o PIN de un solo uso por titular, roles/verificación, representación/delegación y votos ponderados según proceda.
- El número de asistentes es el número de navegadores inscritos, no el número de personas realmente presentes. El organizador sólo se cuenta si también entra como asistente.
- El organizador debe **mantener la sesión anónima del navegador** con la que creó la reunión; si borra el almacenamiento del navegador podría perder el acceso al panel. Se recomienda evolucionar a acceso de administrador con email/contraseña.
- Cada código representa acceso a esa sesión. No envíes códigos a personas ajenas.
- No hay límites de rate-limit personalizados en la función de acceso; para un uso público masivo se recomienda añadirlos junto a CAPTCHA y mecanismos antiabuso.
- Si el código fuente es público, **no es un problema que la clave anon/publishable sea visible**: está diseñada para frontend; la seguridad depende de las políticas RLS. Revisa los permisos antes de producción.

## Próximas mejoras recomendadas
- Censo de propietarios con vivienda, coeficiente, poderes y validación de asistentes.
- Participación presencial/remota y quórum; actas y exportación PDF.
- Inicio de sesión robusto para administrador, cierre formal de la sesión y auditoría.
- QR visible para proyectar en la sala.

## Archivos
- `index.html`: pantallas.
- `styles.css`: diseño responsive.
- `app.js`: lógica, paneles y consultas Supabase.
- `config.js`: URL y clave pública Supabase (debes completar).
- `schema.sql`: tablas, acceso y reglas de seguridad.

## Actualización v1.1 — Censo de viviendas y representación múltiple

Después de ejecutar `schema.sql`, ejecuta `upgrade_viviendas.sql` en el SQL Editor de Supabase. Si ya habías instalado la primera versión, **solo** tienes que ejecutar `upgrade_viviendas.sql` y sustituir los archivos web; no vuelvas a ejecutar el esquema inicial. Los votos antiguos por navegador no se migran; crea una sesión nueva para utilizar el modelo por vivienda.

1. Crea la sesión. Importa un archivo CSV o añade viviendas manualmente. Encabezados soportados: `portal;planta;puerta` (ej.: `45;4;A`), `portal;vivienda` o `vivienda`.
2. Cada participante entra con el enlace/código; su pantalla muestra un identificador personal de ocho caracteres (primeros ocho del UUID anónimo).
3. En el panel, selecciona un asistente y marca una o más viviendas; pulsa **Asignar seleccionadas**. Puedes asignar diez viviendas a una misma persona, pero una vivienda solo puede tener un representante activo.
4. Cuando comienza la primera votación, se bloquea el censo y sus asignaciones. Al votar, el participante emite la misma opción para **todas** sus viviendas. Cada vivienda suma un voto.
5. El resultado y el CSV muestran viviendas votantes, no número de teléfonos ni coeficientes.

**Limitaciones:** el código personal sirve para identificar al navegador, no verifica la identidad civil. El organizador debe comprobar autorización, representación y elegibilidad antes de asignar viviendas. No hay aún papeletas diferenciadas por vivienda para un representante que quiera votar distinto por cada una, ni validación jurídica del acuerdo. Se recomienda usarlo primero en sesiones de prueba, y para votaciones vinculantes añadir verificación, acta, trazabilidad y revisar los requisitos de la comunidad y la normativa aplicable.