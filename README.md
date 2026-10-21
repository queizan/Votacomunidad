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