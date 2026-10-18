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

## Configuración local de Turso para Windows

La aplicación de escritorio carga un archivo `.env` externo al instalador desde la carpeta de datos de usuario que Electron devuelve mediante `app.getPath('userData')`. Crea ese archivo con este contenido:

```dotenv
TURSO_DATABASE_URL=libsql://TU-BASE.turso.io
TURSO_AUTH_TOKEN=TU_TOKEN
```

No reemplaces los valores por credenciales reales dentro del repositorio. No compartas el archivo `.env` ni lo incluyas en el instalador. En un despliegue con API remota, estas credenciales deben permanecer en el servidor, no en el equipo cliente.
