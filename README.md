# POSVEN3 — Aplicación de escritorio

POSVEN3 es una aplicación de punto de venta para Windows, construida con Electron y Next.js. Está diseñada para operar con una base de datos SQLite local centralizada en una computadora servidor y varias computadoras cliente dentro de la misma red.

## Arquitectura de escritorio y red local

- **Una PC SERVIDOR** aloja el servicio local de POSVEN3 y el único archivo SQLite operativo.
- **Varias PC CLIENTE** se conectan a la IP privada y puerto del servidor mediante la aplicación de escritorio.
- Todas las cajas comparten los mismos usuarios, ventas, inventario, movimientos, compras, caja, CxC, CxP, terminales, reportes Z, catálogos y configuración.
- El servidor escucha en el puerto **4580** por defecto.
- Los clientes actualizan sus vistas en segundo plano consultando el servidor LAN.
- No se necesita Internet para operar mientras el servidor y la red local sigan funcionando.
- Los clientes no abren ni comparten directamente el archivo SQLite; todas las operaciones pasan por la API LAN autenticada.
- Si se apaga el servidor o se pierde la LAN, los clientes no confirman ventas ni escriben en colas independientes. Deben reconectar con el servidor.

## Ubicación de la base de datos

En Windows, el archivo se guarda fuera del instalador, en el directorio de datos de usuario de Electron:

`%APPDATA%/PosVEN Pro/data/posven-pro3.sqlite`

Los respaldos de seguridad previos a una restauración se guardan en `data/backups`. Reinstalar la aplicación no debe borrar este directorio de datos.

## Primera configuración

1. Instala POSVEN3 en la computadora que funcionará como servidor.
2. En el primer inicio selecciona **SERVIDOR**.
3. POSVEN3 mostrará la dirección IP privada y el puerto para conectar las demás computadoras.
4. En cada PC cliente instala POSVEN3, selecciona **CLIENTE** e introduce la IP y el puerto mostrados por el servidor.
5. Se recomienda reservar la IP del servidor en el router para evitar que cambie. Si cambia, el cliente permite volver a configurar la dirección.
6. En Windows Firewall permite conexiones privadas entrantes al puerto 4580.

La computadora servidor debe permanecer encendida y con POSVEN3 abierto mientras operen las cajas cliente. Mantén el puerto 4580 dentro de una red privada confiable, protegida con WPA2/WPA3; no configures reenvío del puerto hacia Internet. El tráfico LAN usa HTTP local, por lo que no debe utilizarse en redes públicas o no confiables.

## Usuarios

Las contraseñas se almacenan con hash scrypt y las sesiones residen en SQLite. Los roles disponibles son administrador y cajero.

En una instalación nueva se crea el usuario semilla:
- Usuario: `admin`
- Correo: `admin@posven.local`
- Contraseña inicial: `admin123`

Cambia esa contraseña antes de utilizar el sistema con operaciones reales.

## Respaldos y restauración desde POSVEN2

POSVEN3 genera respaldos JSON desde SQLite local. Para recuperar información de POSVEN2 utiliza el respaldo administrativo completo que genera POSVEN2; no copies archivos internos de bases de datos remotas.

La restauración valida tablas, catálogos, versión y conteos, crea una copia de seguridad de la SQLite actual y reemplaza los datos dentro de una transacción. Al terminar ejecuta comprobaciones de integridad y claves foráneas. Si algo falla, la transacción se revierte y la base anterior permanece disponible. La restauración invalida las sesiones de las otras cajas; deberán iniciar sesión nuevamente.

Los respaldos administrativos de POSVEN2 no contienen hashes de contraseña. POSVEN3 conserva los identificadores y datos de cada usuario, genera contraseñas temporales aleatorias y descarga un archivo privado con esas claves. Los hashes presentes en respaldos SQLite de POSVEN3 se conservan.

## Generar el instalador Windows

GitHub Actions compila el instalador Windows x64. En la pestaña **Actions**, ejecuta el flujo **Build Windows EXE artifacts (no GitHub Release)** y descarga el artefacto **PosVEN-Pro3-Windows-Installer** cuando el trabajo finalice correctamente.

Comandos locales:
- `npm install`
- `npm run build`
- `npx electron-builder --win --publish never`

## Pruebas de aceptación antes de producción

- Inicio de sesión y creación del administrador semilla.
- Una PC servidor y al menos tres PC cliente.
- Ventas simultáneas, inventario y Kardex entre cajas.
- Compras, caja, CxC, CxP y contabilidad.
- Cierre Z transaccional, bloqueo de doble cierre y correlativo nuevo al reabrir.
- Caída de Internet manteniendo la LAN.
- Desconexión y reconexión de un cliente.
- Respaldo, restauración POSVEN2, recuperación de usuarios y rollback.
