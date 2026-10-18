# Migración POSVEN PRO → Turso

## Objetivo
Migrar únicamente el proyecto nuevo `posven-pro` a Turso sin tocar el sistema antiguo `posven.vercel.app`.

## Autenticación
Firebase Authentication queda fuera de la migración.

Se crea autenticación propia:
- administrador semilla obligatorio: `admin`
- contraseña semilla: `admin123`
- rol: `administrador`
- contraseña almacenada únicamente como hash
- el administrador puede crear los demás usuarios
- el usuario administrador actual del negocio se registrará nuevamente en Turso con la contraseña actual que conserva el propietario

## Fuentes Firestore/RTDB auditadas
Persistencia operativa detectada:
- productos
- movimientos
- ventas
- cxc
- cxp
- clientes
- proveedores
- devoluciones
- anulaciones
- terminales
- libroDiario
- reportesZ
- caja
- compras
- operaciones (idempotencia)
- auditoriaSistema
- users (perfil, no contraseñas)
- config/general
- catalogos/*
- documentos legacy pos_system_data/state y data/state, si existen
- espejo RTDB pos_system_data/productos

El espejo RTDB no se considerará una fuente independiente hasta comprobar si contiene datos únicos; se conserva durante la fase de respaldo/auditoría.

## Regla de preservación
Cada documento migrado conserva:
1. su ID original;
2. el JSON completo en `data_json`;
3. campos indexados sólo cuando son necesarios para consultas/operaciones.

Esto evita perder campos anidados o campos futuros durante la primera migración.

## Reinicio de fábrica
El reinicio de fábrica debe:
1. limpiar los datos operativos configurables según la política del sistema;
2. revocar sesiones existentes;
3. conservar o recrear el administrador semilla;
4. garantizar nuevamente `admin / admin123 / administrador`;
5. dejar el sistema listo para volver a configurarse.

No se debe depender de Firebase para recuperar el acceso después de un reinicio.

## Secuencia segura
1. Respaldar Firebase completo.
2. Validar el JSON y sus conteos.
3. Importar a SQLite/Turso.
4. Crear/validar administrador semilla.
5. Crear usuario administrador real del propietario.
6. Implementar sesiones propias.
7. Sustituir lecturas/escrituras de Firebase en POSVEN PRO.
8. Probar caja, ventas, inventario, CxC/CxP, pagos, X/Z, recuperación e idempotencia.
9. Sólo después retirar Firebase de POSVEN PRO.
10. Mantener `posven.vercel.app` intacto hasta cerrar la validación.


## Preservación de identidad de cajeros

La migración de usuarios NO crea un cajero nuevo desconectado de sus históricos.

Para cada usuario existente de Firebase se conservarán:
- el Firebase UID original en `users.firebase_uid`;
- el mismo UID como `users.id` cuando no exista conflicto;
- nombre, correo, rol, estado y fecha de creación;
- el documento/perfil original completo en `data_json`;
- una entrada en `user_identity_map` con la relación entre la identidad Firebase y el usuario Turso.

### Por qué esto preserva la caja

El sistema actual guarda referencias de identidad en datos como:
- `terminales.usuarioId`;
- `ventas.cajeroId`;
- registros de caja/operaciones y auditoría;
- otros documentos que puedan conservar el UID dentro de `data_json`.

Al conservar el mismo UID, esos históricos no se deben reescribir sólo por cambiar el motor de persistencia.

### Contraseñas

Firebase Authentication no entrega las contraseñas en texto plano. Firebase sí permite exportar cuentas y, para determinados esquemas, hashes de contraseña; la documentación oficial indica que los parámetros de hash son específicos del proyecto. Por ello la migración de identidad/historial se hará independientemente de la migración de credenciales. Cada usuario migrado tendrá una credencial Turso establecida durante el proceso, sin modificar sus históricos.

Referencia oficial: Firebase documenta la exportación/importación de usuarios y sus parámetros de hash en su documentación de Authentication.

### Regla de validación obligatoria

Antes de retirar Firebase de POSVEN PRO se debe comprobar, para cada cajero migrado:

1. inicia sesión en Turso;
2. el sistema encuentra la misma terminal/caja;
3. la caja conserva apertura/cierre e historial;
4. sus ventas históricas siguen mostrando el cajero correcto;
5. devoluciones, anulaciones, cobros y demás operaciones conservan la relación;
6. X/Z y recuperación después de refrescar/reiniciar conservan los mismos datos.

No se considera completada la migración de un cajero si cualquiera de esas relaciones se pierde.


## Importador Firebase → Turso

Se agregó `src/lib/turso/migration.ts` y el endpoint administrativo `POST /api/migration/firebase`.

El endpoint funciona en dos fases:
1. **Dry-run (por defecto):** valida el respaldo y devuelve conteos sin escribir datos.
2. **Importación confirmada:** requiere sesión de administrador Turso y el texto exacto `MIGRAR_FIREBASE_A_TURSO`.

La importación conserva los payloads originales completos en `data_json`, conserva IDs, importa terminales/caja/ventas/movimientos/X/Z y registra `migration_runs`.

### Contraseñas de usuarios migrados

El respaldo POSVEN no contiene contraseñas de Firebase Authentication. Si no se proporciona `passwordByFirebaseUid`, se genera una contraseña temporal aleatoria para el usuario migrado. Esa contraseña NO se muestra ni se guarda en el respaldo. Antes de entregar el acceso al cajero debe establecerse una contraseña conocida mediante el flujo administrativo correspondiente.

### Seguridad

El endpoint está bloqueado mientras Turso no esté configurado. No se ejecuta durante la transición Firebase. La importación destructiva requiere confirmación explícita.


## Auditoría de relaciones usuario → terminal → caja → operación

La migración conserva las referencias históricas dentro de `data_json` sin renombrarlas ni sustituirlas por valores inventados. El modelo actual utiliza:

- `terminales.usuarioId`: asignación de una caja/terminal al UID del cajero.
- `ventas.terminalId`: terminal que originó la venta.
- `ventas.cajeroId`: UID del cajero que realizó la venta.
- `movimientos.terminalId`: terminal asociado al movimiento de inventario.
- `devoluciones.terminalId` y `anulaciones.terminalId`: terminal de la operación relacionada.
- `libroDiario.terminalId`: terminal que originó el asiento de caja.
- `reportesZ.terminalId`: terminal cuyo corte Z fue generado.
- `compras.terminalId`: terminal asociado a la compra cuando corresponde.
- `cashHistory[].terminalId`: terminal de cada sesión de caja histórica.
- `auditoriaSistema.terminalId` y `auditoriaSistema.usuarioId`: trazabilidad de interrupciones y eventos administrativos.

Durante la verificación se recorren también objetos anidados y se detectan referencias explícitas adicionales (`usuarioId`, `userId`, `firebaseUid`, `cajeroId`, `createdBy`, `openedBy`, `closedBy`, etc.). Las referencias de usuario se validan contra `users.id` y `users.firebase_uid`; las de terminal contra `terminales.id`.

### Regla de compatibilidad

No se deben reemplazar los Firebase UID históricos por nombres de usuario. Mientras exista compatibilidad de transición, el UID queda conservado y `user_identity_map` permite relacionarlo con el nuevo `users.id`. Esto mantiene intactos los registros históricos y permite que el sistema Turso resuelva la identidad sin perder la trazabilidad del cajero original.


## Validación de entorno Preview

Las variables `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` deben estar configuradas para **Preview** antes de validar el login Turso. La configuración de **Production** se mantiene sin cambios durante esta fase.

## Redeploy de validación

Este cambio documental se utiliza únicamente para forzar un nuevo deployment de la rama `turso-migration` después de configurar las variables de entorno Preview. No modifica la lógica de autenticación ni el entorno Production.
