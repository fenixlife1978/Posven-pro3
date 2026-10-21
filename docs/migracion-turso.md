# Sustitución de base remota por SQLite local

Este proyecto pasa a una arquitectura de escritorio sin base de datos en la nube.

- La única fuente operativa debe ser SQLite local.
- El archivo de base de datos se define por la variable interna `POSVEN_SQLITE_PATH`, configurada por Electron dentro del directorio de datos del usuario.
- No se deben solicitar ni almacenar `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TURSO_API_TOKEN` ni credenciales Firebase.
- Los nombres históricos de módulos y rutas pueden mantenerse temporalmente por compatibilidad del código, pero no pueden abrir conexiones remotas.
- La persistencia de ventas, inventario, usuarios, cuentas por cobrar/pagar, movimientos, cajas y cierres debe ejecutarse transaccionalmente en el archivo SQLite local.
- El instalador debe iniciar el servidor Next.js embebido en localhost y apuntar la interfaz a ese servidor; no debe depender de una web alojada.

## Validaciones obligatorias antes de publicar

1. Instalar en una máquina Windows limpia sin credenciales ni conexión a internet.
2. Crear el administrador inicial y verificar el hash de contraseña.
3. Crear/editar productos, incluidos los vendidos por kg y por litro.
4. Registrar ventas, pagos, devoluciones, movimientos y cierres X/Z.
5. Cerrar y volver a abrir la aplicación; confirmar que todos los datos siguen en SQLite.
6. Comprobar que una caída de internet no bloquea ninguna operación local.
7. Comprobar que no hay llamadas operativas a dominios externos ni variables de entorno de Turso/Firebase.
8. Probar restauración de una copia de seguridad.

Este documento describe el objetivo de arquitectura; las validaciones anteriores deben pasar antes de declarar una versión de producción lista.
