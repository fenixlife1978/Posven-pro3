# Auditoría técnica inicial para migrar POSVEN3 a SQLite Local LAN

Fecha de revisión: 2026-11-11  
Rama inspeccionada: `feat/pos3-ajustes-caja-z-80mm` / rama de migración `feat/pos3-sqlite-local-lan`  
Repositorio: `fenixlife1978/Posven-pro3`

## Estado de esta auditoría

Esta es una inspección estática del código del repositorio. No se ha ejecutado el proyecto ni se han realizado pruebas de compilación o instalador desde esta revisión. No representa una migración funcional terminada.

## Hallazgos verificados

### 1. Empaquetado y proceso Electron

- `package.json` establece `main.js` como punto de entrada. Por tanto, el archivo raíz `main.js` es el arranque productivo de Electron.
- El repositorio también contiene `electron/main.js` y `electron/preload.js`, pero el manifiesto actual no los señala como entrada. No deben confundirse con los archivos activos.
- El `main.js` raíz inicia Next.js dentro del proceso Electron cuando la aplicación está empaquetada y escucha únicamente en `127.0.0.1`, en un puerto aleatorio.
- El `preload.js` raíz expone actualmente impresión y versión; no ofrece configuración de servidor LAN, estado de conexión ni acceso a SQLite.
- La ventana usa `contextIsolation: true` y `nodeIntegration: false`, lo cual debe conservarse.
- El inicio todavía carga variables `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` desde un archivo externo y define `TURSO_MIGRATION_BUILD`.

### 2. Persistencia del frontend

- `src/lib/db-store.ts` concentra el estado y la mayoría de las operaciones del POS.
- Sus lecturas y escrituras principales pasan por `/api/turso/store`.
- El archivo mantiene una caché en memoria y `localStorage` para acelerar la interfaz; sus comentarios no la consideran fuente de verdad.
- Hay funciones heredadas que aún contienen referencias a Firestore/Realtime Database, pero sus adaptadores están sustituidos por funciones que lanzan errores. No se deben reactivar como mecanismo alternativo.
- La cola `src/lib/offline-queue.ts` guarda operaciones en `localStorage` y procesa pendientes cuando vuelve `navigator.onLine`. Fue diseñada para el flujo anterior y no sustituye una base SQLite central en servidor LAN.
- Las operaciones críticas (venta, inventario, pagos, compras, devoluciones/anulaciones, movimientos de caja y Z) necesitan conservar sus contratos y garantías al trasladarlas a SQLite.

### 3. Persistencia y autenticación del servidor

- `src/lib/turso/client.ts` implementa el cliente SQL HTTP de Turso.
- `src/lib/turso/pos-store.ts` contiene las operaciones transaccionales del negocio y la lógica de cierre Z.
- `src/lib/turso/schema.sql` y `schema-init.ts` definen el esquema actual.
- `src/lib/auth/turso-auth.ts` implementa hash scrypt, usuarios, bloqueo, administrador semilla y sesiones persistidas.
- Las rutas `/api/auth/*`, `/api/users/*` y `/api/turso/store` dependen de esos módulos.
- La ruta de usuarios PATCH consulta directamente Turso; esa consulta también debe migrarse, no solo el login.
- El frontend de login informa explícitamente que inicializa/conecta Turso y necesita convertirse a autenticación local del servidor LAN.

### 4. Respaldos

- `src/lib/backup.ts` crea el respaldo leyendo las tablas y catálogos mediante endpoints Turso.
- El formato actual es JSON con `app: posven-pro`, versión 3 y colecciones de datos. Los metadatos identifican explícitamente la fuente Turso.
- La restauración actual llama a `/api/turso/backup` y realiza un reset seguido de lotes de tablas/configuración. No es adecuada como restauración segura de la futura base SQLite activa.
- La restauración local deberá ejecutarse sobre una base temporal, validar integridad y relaciones, respaldar la base activa y sustituirla atómicamente solo después de pasar las verificaciones.

### 5. Compilación

- El workflow Windows usa Node 20, `npm ci`, `npm run build` con `TURSO_MIGRATION_BUILD=1` y construye el instalador Electron.
- El build actual verifica un runtime Next.js para API Turso.
- El workflow debe migrarse a un build de aplicación de escritorio servidor/cliente y añadir validaciones SQLite. Cualquier dependencia SQLite nativa deberá compilarse para la versión concreta de Electron; no se debe marcar el instalador listo sin verificar ABI, rebuild y ejecución real en Windows.

## Inventario inicial del esquema actual

El archivo `src/lib/turso/schema.sql` declara estas tablas:
`app_config`, `users`, `catalogos`, `productos`, `movimientos`, `ventas`, `cxc`, `cxp`, `clientes`, `proveedores`, `devoluciones`, `anulaciones`, `terminales`, `libro_diario`, `reportes_z`, `caja`, `compras`, `operaciones`, `auditoria_sistema`, `legacy_documents`, `sessions` y `migration_runs`.

El esquema utiliza JSON por registro en varias tablas; se debe mantener compatibilidad con los objetos que consume `AppState` mientras se migra el acceso. También se debe verificar si los respaldos históricos contienen documentos/tablas adicionales.

## Decisiones de implementación derivadas

1. Mantener el contrato de datos consumido por React y sustituir la capa de transporte/persistencia detrás de él, en vez de reescribir módulos de negocio y UI todos a la vez.
2. El servidor LAN alojará la única SQLite y todas las operaciones de escritura. Los clientes cargarán la UI desde el servidor LAN, ejecutada dentro de su propia ventana Electron; el preload seguirá proporcionando impresión local en cada PC.
3. El servicio LAN usará autenticación y autorización en servidor. Nunca se expondrá un método SQL genérico a los clientes.
4. La primera instalación ofrecerá seleccionar «Este equipo será el servidor» o «Conectar a un servidor existente». El servidor mostrará IP/puerto; el cliente guardará el endpoint elegido y permitirá volver a configurarlo.
5. La IP fija se recomienda mediante reserva DHCP en el router. El descubrimiento automático puede facilitar el alta, pero no será requisito para conectarse.
6. El almacenamiento de la base se ubicará en `app.getPath('userData')`, fuera de `app.asar` y del directorio de instalación.
7. La base se abrirá solo desde el proceso servidor. No se compartirá el archivo por SMB ni se permitirá que los clientes lo abran directamente.
8. El transporte LAN tendrá health check, timeout, manejo de desconexión y mensajes claros. Una operación crítica solo se considera exitosa después de confirmación del commit central.
9. La sincronización entre computadoras es la propia escritura centralizada en SQLite; no habrá réplica entre clientes ni sincronización cloud.
10. Los datos históricos de POSVEN2 se importarán desde un archivo exportado y validado, sin conexión permanente ni credenciales de POSVEN2.

## Próximas tareas de código

- Definir y añadir el motor SQLite compatible con Electron 34 / Node 20, actualizando manifiesto y lockfile de forma reproducible.
- Implementar módulo de apertura de base, migraciones, repositorios, transacciones e idempotencia.
- Implementar servidor LAN y modo cliente/servidor en Electron.
- Crear un adaptador de API central para que `db-store.ts`, login, usuarios, catálogos y respaldos utilicen el servidor SQLite.
- Migrar operación por operación desde `pos-store.ts`, manteniendo y reforzando el cierre Z idempotente.
- Rehacer backup/restauración local y el importador compatible con POSVEN2.
- Retirar módulos Turso y referencias antiguas solo después de que no existan consumidores.
- Actualizar README, workflows, instalador y pruebas de aceptación.
