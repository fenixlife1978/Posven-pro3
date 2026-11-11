# POSVEN3 — Escritorio con SQLite Local y servidor LAN

## Arquitectura

- POSVEN3 se instala y ejecuta como aplicación de escritorio Electron en Windows.
- Una computadora se configura como **SERVIDOR**. En ella se ejecuta Next.js embebido y se aloja el único archivo SQLite operativo.
- Las demás computadoras se configuran como **CLIENTES** y abren la aplicación contra la IP privada y el puerto del servidor.
- El servidor escucha en el puerto 4580 por defecto y en la interfaz LAN (`0.0.0.0`). Solo acepta conexiones cuyo origen sea una dirección privada IPv4/IPv6 local.
- Todas las ventas, inventario, movimientos, compras, caja, CxC, CxP, usuarios, terminales, reportes Z y configuración se consultan y escriben en la misma SQLite del servidor.
- No hay base de datos cloud ni backend web remoto en el circuito operativo.
- Los clientes consultan cambios del servidor en segundo plano mediante intervalos cortos. No se crean bases independientes en cada PC ni colas de ventas offline.

## Datos locales del servidor

El archivo se crea bajo el directorio de datos de usuario de Electron:

`%APPDATA%/PosVEN Pro/data/posven-pro3.sqlite`

SQLite usa WAL, `synchronous=FULL`, claves foráneas y espera de bloqueo de hasta 10 segundos. Los respaldos de seguridad de restauraciones se guardan en el subdirectorio `data/backups`.

La PC servidor debe permanecer encendida y POSVEN3 debe estar abierto para que las cajas cliente puedan operar. Si se pierde Internet pero la red local sigue funcionando, las cajas continúan trabajando contra el servidor. Si se pierde la LAN o se apaga el servidor, los clientes no pueden registrar operaciones hasta reconectar; POSVEN3 no confirma ventas en una cola local independiente.

## Configuración de red

En el primer inicio se elige SERVIDOR o CLIENTE. En modo cliente se introduce la IP privada y puerto que muestra el servidor. La configuración se guarda localmente en `posven-network.json`.

Se recomienda reservar la IP del servidor en el router. Si la IP dinámica cambia, el cliente detecta que el servidor no responde y permite volver a configurar la dirección. Windows Firewall debe permitir conexiones privadas entrantes al puerto 4580.

## Inicio de sesión y usuarios

- Las contraseñas locales se almacenan con hash scrypt.
- Los roles admitidos son administrador y cajero.
- El usuario semilla local `admin` se crea cuando no existe un administrador activo. En una instalación nueva, la contraseña inicial predeterminada es `admin123`; debe cambiarse antes de usar el sistema con datos reales.
- Los clientes se autentican contra la misma tabla de usuarios del servidor y guardan sesiones en SQLite.

## Respaldos y restauración

POSVEN3 genera respaldos JSON desde SQLite local. Para recuperar información histórica de POSVEN2 se utiliza su exportación administrativa completa, no un archivo interno de la base de datos.

La restauración:
1. valida versión, tablas, catálogos y conteos del manifiesto;
2. rechaza respaldos incompletos o posiblemente truncados;
3. crea una copia física de seguridad de la SQLite actual;
4. reemplaza los datos dentro de una transacción SQLite;
5. ejecuta comprobaciones de integridad y claves foráneas antes de confirmar;
6. conserva el administrador local que inició la restauración.

Los respaldos administrativos de POSVEN2 no incluyen hashes de contraseña. Se recuperan los usuarios con su identificador, nombre, correo, rol y estado de bloqueo, y se generan contraseñas temporales aleatorias que se descargan en un archivo privado al terminar la restauración. Los hashes presentes en respaldos SQLite de POSVEN3 sí se conservan.

## Cierre Z

El cierre Z se registra en una transacción SQLite: valida que la caja esté abierta, reserva un correlativo no reutilizable, guarda el reporte, cierra la terminal y reinicia los fondos de la jornada. Si la transacción falla, no se confirma parcialmente el cierre.

## Validación antes de instalar

Probar en una red local real:
- primer inicio y creación del administrador semilla;
- conexión de al menos tres PC cliente;
- venta simultánea desde cajas distintas;
- stock y Kardex actualizados entre cajas;
- CxC, CxP, compras y movimientos de caja;
- cierre Z, bloqueo de doble Z y nuevo correlativo al reabrir;
- pérdida y recuperación de Internet manteniendo la LAN;
- pérdida y recuperación de conexión con el servidor;
- respaldo, restauración POSVEN2, credenciales temporales y rollback.
