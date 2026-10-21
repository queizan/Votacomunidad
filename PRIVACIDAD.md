# Privacidad y eliminación de datos · VotaComunidad

**Política adoptada:** se exporta un Excel con resultados agregados y detalle de votos por vivienda y, a petición explícita del organizador al finalizar la reunión, se elimina inmediatamente el conjunto de datos operativo activo. No se conserva un histórico de sesiones en la app. El acceso al detalle de votos por vivienda está restringido a la identidad técnica del organizador mediante la función SQL `export_session_details`.

## Exportación detallada (v1.5)
La nueva migración [07_exportacion_excel_detallada.sql](07_exportacion_excel_detallada.sql) permite exportar una hoja «Resumen» con preguntas, estados y recuentos por opción, más una hoja por pregunta con listas de viviendas por respuesta y viviendas sin votar. Es imprescindible informar a los participantes de que **el organizador puede conocer qué votó cada vivienda**. No incluir nombres de propietarios en el censo. No compartir el XLSX públicamente.

## Qué se elimina
- Código de sesión, preguntas, censo de portales/viviendas, asignaciones, miembros y votos individuales.
- Los identificadores de Auth *anónimos* sin referencias en otras sesiones se eliminan desde una Edge Function, nunca desde el navegador.

## Qué NO puede garantizarse
- El Excel .xlsx descargado pasa a estar bajo responsabilidad del organizador. Incluye la relación exacta entre vivienda y voto: **no es un informe anónimo para el organizador**. No se puede borrar el archivo de su equipo ni el caché o capturas de otros usuarios.
- Datos purgados de la base activa pueden existir temporalmente en backups, PITR y registros técnicos de Supabase. La retención depende del plan y la configuración real. No prometemos borrado instantáneo de backups ni anonimato absoluto (durante la reunión existe vinculación voto-vivienda para evitar duplicidades).
- La mera identidad anónima de Supabase genera un ID persistente durante la sesión; registros de red y otros metadatos técnicos pueden existir.
- Un JWT existente puede seguir siendo criptográficamente válido hasta expirar aunque se elimine auth.users. Las consultas a sesiones borradas dejan de funcionar, si RLS está correctamente configurado.

## Preparación (OBLIGATORIA antes de utilizar el botón)
1. Instala los SQL originales `schema.sql` y `upgrade_viviendas.sql` de la aplicación. **No estaban publicados en el repositorio al elaborar esta actualización**. Sin estos esquemas no está operativo el sistema de votación.
2. Revisa nombres de tablas y FK de tu esquema y ejecuta `privacy_purge.sql` en Supabase SQL Editor. La función comprueba `auth.uid()`, propiedad y preguntas abiertas, y elimina datos en una única transacción.
3. Despliega `supabase/functions/finalizar-reunion/index.ts` como Edge Function **con validación JWT habilitada** (no desactivar `verify_jwt`), por CLI: `supabase functions deploy finalizar-reunion`.
4. Mantén **SUPABASE_SERVICE_ROLE_KEY** solo como secreto del servidor Supabase. Jamás la introduzcas en `config.js`, GitHub o frontend. Asegura también las políticas RLS de las tablas operativas.
5. Prueba con dos móviles y datos inventados. Al finalizar verifica que todas las tablas quedaron vacías para esa sesión, que el enlace queda invalidado y que Auth eliminó exclusivamente usuarios anónimos sin referencias en otras sesiones.
6. **Advertencia:** si la purga SQL se confirma pero falla la llamada Auth, la sesión ya no existe y la limpieza de esos usuarios no se puede reintentar desde el panel. Crea una tarea de mantenimiento administrativa que revise usuarios anónimos huérfanos (sin asociaciones con sesiones) y los elimine con una antigüedad prudente. Evita borrar cuentas permanentes.

## Limitaciones funcionales
- El navegador solo puede comprobar que se inició la descarga del Excel, no que el organizador lo haya guardado correctamente. El organizador debe abrirlo y comprobarlo antes de autorizar el borrado.
- El cierre debe requerir confirmación doble. No existe deshacer.
- Los resultados no quedan disponibles online tras borrar la sesión.
- No se crea por defecto una tarea de limpieza automática de sesiones abandonadas. Implementar un mecanismo separado de expiración evita retenciones indefinidas si el organizador no completa el cierre.
- Para votaciones formales de comunidades de propietarios, consulta la necesidad de conservar documentación y evidencias para el acta.

## Fuentes
- https://supabase.com/docs/reference/javascript/auth-admin-deleteuser
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/auth/managing-user-data
