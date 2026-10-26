# POSVEN-PRO3

Aplicación de punto de venta para Windows, construida con Next.js y Electron.

## Arquitectura

- **Base de datos operativa: SQLite local** en el perfil de datos de la aplicación Electron.
- Archivo de base de datos: `posven-pro3.sqlite`, dentro de `app.getPath('userData')`.
- **Sin conexión operativa con Turso, Firebase, Firestore ni servicios de base de datos remotos.**
- Autenticación mediante sesiones propias y contraseñas con hash.
- Aplicación de escritorio Windows x64 generada mediante GitHub Actions.
- Las operaciones requieren que el servidor local de Next.js esté funcionando dentro de la aplicación de escritorio.

La caché del navegador no es la fuente de verdad. Los registros operativos se leen y escriben en SQLite local.

## Generar los instaladores

En GitHub, abre **Actions** y ejecuta el flujo **Build Windows EXE installers (SQLite desktop)**. El flujo debe generar dos instaladores independientes:

- **PosVEN Pro COMPLETO:** sin límites de DEMO.
- **PosVEN Pro DEMO:** limita a 10 las ventas, los productos creados y las compras; al alcanzar el límite de cualquiera de estas categorías, bloquea nuevas operaciones de la DEMO.

No distribuyas instaladores antiguos como si incluyeran cambios recientes. Solo considera una compilación válida cuando el flujo termine correctamente y los archivos generados hayan sido verificados.

## Administrador semilla

En la primera ejecución, si no existe ningún administrador activo, la aplicación crea o recupera el usuario semilla:

- Usuario: `admin`
- Correo: `admin@posven.local`
- Contraseña inicial predeterminada: `Admin123!`

Se puede definir `POSVEN_SEED_ADMIN_PASSWORD` antes del primer inicio para establecer otra contraseña. Cambia la contraseña inicial después de entrar. Si ya existe un administrador activo, no se crea una cuenta semilla adicional.

## Persistencia y copias de seguridad

La base de datos está vinculada al perfil local de usuario de Electron. Desinstalar y reinstalar no debe considerarse una estrategia de respaldo. Utiliza la función de respaldo de la aplicación y conserva los archivos exportados en una ubicación segura.
