# POSVEN3 — Arquitectura SQLite Local con servidor LAN

Estado: arquitectura objetivo aprobada; implementación pendiente por fases.  
Rama de trabajo: `feat/pos3-sqlite-local-lan`.  
Base de trabajo: `feat/pos3-ajustes-caja-z-80mm` (conserva los cambios existentes del PR #6).  
Alcance: POSVEN3 exclusivamente. No modificar POSVEN2 ni otros repositorios.

## Decisión de arquitectura

POSVEN3 será exclusivamente una aplicación de escritorio Windows. SQLite local será la única base de datos operativa y fuente de verdad. No habrá Turso, Firebase, Firestore, Vercel ni backend cloud en el circuito operativo.

Una computadora designada por el administrador funcionará como servidor LAN. En esa computadora se ejecutarán:
- El proceso principal Electron.
- El servicio HTTP local de POSVEN3, enlazado a la interfaz LAN y protegido por autenticación.
- La única base SQLite central, almacenada en la carpeta de datos de usuario de Electron (fuera del instalador).
- El servicio de respaldos, restauración, auditoría y administración de terminales.

Cada PC cliente ejecutará la aplicación Electron y se conectará al servicio del servidor mediante IP y puerto local. Las computadoras clientes no abrirán el archivo SQLite compartido ni tendrán acceso directo al archivo de base de datos. Todas las lecturas y escrituras pasarán por la API LAN autenticada del servidor.

## Topología y descubrimiento

- El servidor mostrará su IP LAN, puerto y estado del servicio.
- Se recomienda reservar la IP del servidor en el router (DHCP reservation) para evitar cambios.
- La configuración de cliente guardará el host y puerto seleccionados.
- Se podrá añadir descubrimiento automático en la LAN (mDNS/UDP) como ayuda; la IP manual seguirá disponible.
- El servidor escuchará solo en interfaces LAN necesarias, nunca expondrá el servicio a Internet por defecto.
- La instalación configurará o guiará la regla de firewall de Windows para el puerto elegido.
- El puerto por defecto propuesto es 4580, configurable y validado para evitar colisiones.

## Persistencia y consistencia

- SQLite central en el equipo servidor, acceso exclusivo desde el proceso/servicio que aloja la base.
- Prohibido abrir el mismo archivo SQLite desde clientes por unidad de red o carpeta compartida.
- Habilitar foreign keys, WAL, busy_timeout y transacciones explícitas.
- Toda operación de negocio crítica debe ejecutarse como una transacción SQLite en el servidor.
- Las escrituras deben ser idempotentes mediante operationId único persistido en la misma transacción.
- Los correlativos de facturas, devoluciones, anulaciones y cierres Z se asignarán en el servidor bajo transacción y con restricciones únicas.
- El cierre Z debe verificar caja/jornada abierta, crear el snapshot, registrar el cierre, actualizar fondos y estado de la terminal y guardar su auditoría atómicamente. Una jornada cerrada no podrá cerrarse de nuevo por reingreso, reinicio o reintento de red.
- La concurrencia entre cajas se controla en el servidor; ningún cliente calcula ni confirma saldos autoritativos usando únicamente su caché.
- Las lecturas pueden usar caché de interfaz, pero la confirmación de operaciones solo se muestra después del commit de SQLite.

## Autenticación y seguridad LAN

- Usuarios, roles, hashes scrypt, bloqueo de acceso y sesiones residen en SQLite.
- El servidor valida credenciales y permisos en cada operación protegida.
- El preload de Electron expone métodos concretos y validados; no se expone ipcRenderer ni acceso SQL genérico al renderer.
- La API LAN valida origen/cliente, sesión, permisos, tamaño de solicitudes y límites razonables.
- No se incluyen secretos maestros ni contraseñas en el instalador o frontend.
- El acceso remoto fuera de la LAN no se habilita por defecto.

## Caída de Internet, LAN o servidor

- Si cae Internet pero la LAN y el servidor siguen activos, todas las cajas continúan operando normalmente sobre SQLite central. No hay sincronización cloud ni trabajo pendiente hacia servicios externos.
- Si una PC cliente pierde conexión con el servidor, se informa claramente que perdió la conexión central. No se confirmarán operaciones de inventario/caja como guardadas si no existe commit del servidor.
- Si el servidor se apaga o falla, los clientes no podrán consultar ni modificar la base central hasta que el servidor vuelva. Se prioriza no crear bases divergentes ni ventas duplicadas.
- Al reiniciar el servidor se ejecuta comprobación de integridad, recuperación WAL y verificación del último estado de caja antes de aceptar clientes.
- Se preparará una estrategia de respaldo y recuperación ante fallos físicos del servidor.

## Respaldos y restauración POSVEN2

POSVEN2 será únicamente origen histórico de archivos de respaldo para importación. No habrá conexión operativa entre POSVEN2 y POSVEN3.

- El importador aceptará el formato de respaldo exportado por POSVEN2 que se haya verificado.
- La importación será lógica y versionada; no se copiarán archivos internos de una base remota como si fueran archivos SQLite locales.
- Debe inspeccionar y mapear el esquema real completo del respaldo, no limitarse a una lista fija parcial de tablas.
- Se importarán usuarios, roles, configuración, catálogos, inventario, movimientos, ventas, compras, clientes, proveedores, CxC, CxP, caja, terminales, cierres Z, libro diario, auditoría y relaciones presentes en el esquema.
- Antes de restaurar se genera un respaldo íntegro de la base activa.
- La restauración se prepara en una base temporal, valida versión, conteos, integridad SQLite y claves foráneas; solo entonces sustituye atómicamente la base activa.
- Si falla cualquier validación, se conserva intacta la base activa.
- No se importarán datos ficticios ni se borrará información existente silenciosamente.
- Se distinguirá restauración completa de importación selectiva; la restauración completa requerirá confirmación administrativa explícita.

## Esquema inicial detectado en el código actual

El esquema Turso existente usa tablas: `app_config`, `users`, `catalogos`, `productos`, `movimientos`, `ventas`, `cxc`, `cxp`, `clientes`, `proveedores`, `devoluciones`, `anulaciones`, `terminales`, `libro_diario`, `reportes_z`, `caja`, `compras`, `operaciones`, `auditoria_sistema`, `legacy_documents`, `sessions` y `migration_runs`.

Esta lista es punto de partida, no autorización para omitir tablas adicionales que aparezcan en respaldos o datos históricos. Se debe completar un inventario del esquema y de todas las operaciones de lectura/escritura antes de retirar la capa actual.

## Plan de implementación

1. Inventario y mapa de persistencia: localizar todas las dependencias Turso/API, autenticación, usuarios, sesiones, operaciones transaccionales, backup/restore y datos de configuración.
2. Núcleo SQLite: implementar apertura segura, migraciones de esquema, repositorios y transacciones en el proceso servidor.
3. Servicio LAN: iniciar/detener servicio, mostrar IP/puerto, configuración de cliente, autenticación, autorización y health check.
4. Adaptación del frontend: reemplazar llamadas a API Turso por un adaptador único de transporte local/LAN, conservando contratos y pantallas.
5. Migrar todas las operaciones críticas y el cierre Z a transacciones SQLite idempotentes.
6. Usuarios y sesiones locales; eliminar autenticación Turso.
7. Respaldos automáticos, importador POSVEN2, restauración temporal y rollback.
8. Retirar código, variables, rutas, dependencias y documentación Turso/Firebase/Firestore una vez que no exista ninguna referencia operativa.
9. Pruebas automatizadas y de aceptación: una PC, varias cajas, dos o más clientes concurrentes, caída de Internet, caída de LAN, reinicio inesperado, backup/restore, duplicación de requests, caja y Z, ventas, compras, inventario, CxC/CxP y contabilidad.
10. Generar instalador Windows y verificarlo en equipos cliente/servidor. No publicar ni sustituir la versión productiva hasta autorización expresa.

## Criterios para declarar terminado

- No existen llamadas operativas ni dependencias de Turso, Firebase, Firestore o Vercel.
- El modo escritorio funciona sin Internet.
- Varias computadoras comparten una única SQLite a través del servicio LAN.
- Todas las operaciones críticas confirman persistencia después de commit.
- Los correlativos y el Z no se repiten ni se reabren tras salir/entrar.
- Los respaldos y restauraciones pasan validaciones de integridad y rollback.
- Las pruebas de concurrencia, desconexión y recuperación quedan documentadas.
- La producción no se modifica sin autorización explícita del usuario.
