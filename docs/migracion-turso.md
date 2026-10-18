# POSVEN-PRO3: arquitectura Turso

## Fuente de verdad

Turso es la única base de datos operativa para usuarios, sesiones, inventario, ventas, compras, caja, cuentas por cobrar, cuentas por pagar, movimientos y reportes Z. El almacenamiento local solo puede utilizarse como caché de interfaz y nunca como autoridad para confirmar operaciones.

## Autenticación

- Login propio contra las API de la aplicación.
- Contraseñas almacenadas como hash scrypt.
- Sesiones con vencimiento y revocación en Turso.
- Roles admitidos: administrador y cajero.
- Las API deben rechazar operaciones críticas cuando Turso no esté disponible; no se permite un respaldo operativo local.

## Variables del servidor

- `TURSO_DATABASE_URL`: URL de la base de datos Turso.
- `TURSO_AUTH_TOKEN`: token de acceso a Turso.
- `SESSION_SECRET`: secreto de sesión si el despliegue lo requiere.

Estas variables se configuran en el entorno seguro del servidor y no se incluyen en el código del cliente ni en el instalador de Windows.

## Compilación de escritorio

GitHub Actions compila exclusivamente en `windows-latest`. La compilación debe conservar el runtime de Next.js que sirve las API; un export estático no es suficiente para una aplicación que utiliza rutas `/api/*`.

## Reglas de seguridad y consistencia

1. Cada operación crítica debe validar permisos en servidor.
2. Ventas, inventario, caja y deudas deben modificarse en transacciones Turso cuando corresponda.
3. No confirmar una operación si la respuesta del servidor no acredita su persistencia.
4. No incluir credenciales de base de datos en el instalador.
5. Verificar login, creación de usuarios, caja, venta, compra, Corte Z y reimpresión antes de declarar una versión lista.
