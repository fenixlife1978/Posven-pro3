# POSVEN-PRO3

Aplicación de punto de venta instalable para Windows, construida con Next.js y Electron.

## Arquitectura de escritorio

- **Base de datos operativa única: SQLite local** en el equipo donde se instala el sistema.
- Archivo de datos: `app.getPath('userData')/posven-pro3.sqlite` (ruta de datos de usuario de Electron, fuera de la carpeta de instalación).
- No requiere cuenta, URL, token ni conexión a Turso, Firebase o cualquier base de datos en la nube.
- Las rutas API que conservan nombres históricos se ejecutan dentro del servidor Next.js local embebido en Electron; no son endpoints remotos.
- La aplicación y sus operaciones de negocio deben seguir funcionando sin internet. Internet solo puede utilizarse para funciones opcionales explícitas, como comprobar actualizaciones.

## Generar el instalador

Abre GitHub Actions y ejecuta **Build Windows EXE (Local SQLite only)**. El instalador se genera para Windows x64.

## Datos locales y copias de seguridad

La base de datos y su archivo WAL se guardan fuera de la carpeta de instalación. Actualizar o reinstalar la aplicación no debe borrar la información. Para respaldar el sistema, cierra la aplicación y copia el archivo `posven-pro3.sqlite` junto con cualquier archivo `posven-pro3.sqlite-wal` o `posven-pro3.sqlite-shm` que exista. La función de respaldo integrada debe preferirse cuando esté disponible.

## Cuenta inicial

La cuenta de administrador inicial todavía usa el mecanismo de semilla existente. Antes de distribuir el instalador a clientes debe reemplazarse la contraseña predeterminada por un proceso seguro de configuración inicial y probarse la recuperación de acceso.
