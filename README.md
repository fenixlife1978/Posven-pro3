# POSVEN-PRO3

Aplicación de punto de venta para Windows, construida con Next.js y Electron.

## Arquitectura

- Base de datos operativa: Turso (libSQL/SQLite remoto).
- Autenticación: sesiones propias de la aplicación y contraseñas con hash.
- Aplicación de escritorio: instalador Windows x64 generado mediante GitHub Actions.
- Compilación: exclusivamente en runner Windows; no se construyen paquetes Linux.
- Las credenciales de Turso deben configurarse en el servidor que ejecuta las API y nunca incrustarse en el frontend ni en el instalador.

## Generar el instalador

Abre la pestaña Actions, ejecuta Build Windows EXE (Turso only) y descarga el artefacto PosVEN-Pro3-Windows-Installer.

## Variables de entorno para las API

- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- SESSION_SECRET (si se habilita para firma adicional de sesiones en el despliegue)

No añadas credenciales al repositorio ni al instalador.
