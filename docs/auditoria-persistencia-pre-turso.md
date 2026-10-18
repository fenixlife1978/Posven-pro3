# Auditoría de persistencia antes de conectar Turso

Fecha: 2026-09-22
Repositorio: fenixlife1978/posven-pro
Rama: main

## Estado

Auditoría completada sin conectar Turso y sin retirar variables de Firebase.

## Persistencia Firestore confirmada

La persistencia principal está en `src/lib/db-store.ts` y utiliza:

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
- config/general
- catalogos/{nombre}
- operaciones
- auditoriaSistema

Se confirmaron transacciones para validación optimista, inventario/deudas e idempotencia.

## RTDB

`pos_system_data/productos` está implementado como espejo de productos para lecturas rápidas/en tiempo real.

Conclusión: en Turso la fuente de verdad será `productos`. El espejo RTDB se conserva en el respaldo para auditoría y no se debe mantener como segunda fuente de verdad.

## Legacy

Se confirmaron las rutas históricas:

- `pos_system_data/state`
- `data/state`

La aplicación actual ya no depende operativamente de ellas; se conservan como origen/histórico hasta completar la migración.

## Usuarios y autenticación

El perfil Firebase `users` se utiliza actualmente junto con Firebase Authentication.

La nueva implementación tendrá autenticación propia sobre Turso, sesiones persistentes y contraseñas almacenadas únicamente mediante hash.

Se debe garantizar el administrador semilla definido para recuperación de fábrica y conservar la capacidad del administrador actual para volver a registrarse en el sistema migrado.

## Formateo de fábrica

El código actual elimina `users` por completo. Esto debe cambiar en Turso:

1. limpiar datos operativos/configurables;
2. revocar sesiones;
3. eliminar usuarios normales;
4. recrear siempre el administrador semilla;
5. impedir que el sistema quede sin acceso administrativo.

## Próxima etapa

Quedan por implementar:

1. conexión Turso;
2. repositorio equivalente a `db-store.ts`;
3. autenticación/sesiones;
4. usuarios;
5. factory reset seguro;
6. refresco/invalidation equivalente a los listeners Firestore;
7. importador JSON;
8. validación de conteos, IDs y duplicados;
9. pruebas funcionales completas de ventas, caja, CxC/CxP, devoluciones, anulaciones, X/Z y recuperación.

## Límite de seguridad

Todavía NO se ha conectado la aplicación a Turso y NO se han eliminado variables Firebase.

Cuando comience la conexión real de Turso, se debe detener el proceso y avisar antes de retirar las variables Firebase únicamente de `posven-pro.vercel.app`.

`posven.vercel.app` permanece intacto como respaldo.
