# Auditoría de paridad POSVEN-Pro → POSVEN-Pro3

**Corte de comparación:** 18-11-2026  
**Referencia funcional:** `fenixlife1978/posven-pro`, rama `main`  
**Destino:** `fenixlife1978/Posven-pro3`, rama `main` (cambios de esta ronda en PR #40)

## Principio de adaptación

POSVEN-Pro sirve como referencia para descubrir reglas de negocio y mejoras. POSVEN-Pro3 conserva SQLite local como única fuente operativa, transacciones atómicas, operación LAN y aislamiento por terminal. No se copian Turso, Firebase/Firestore, autenticación remota ni colas de sincronización como autoridad de datos.

## Diferencias identificadas

| Área | Estado en POSVEN-Pro3 | Acción / criterio |
|---|---|---|
| POS / ventas | La lógica de `PosModule.tsx` de Pro está integrada en `SalesModule.tsx`; Pro3 ya añade selección fraccionada, detalle CxC, movimientos manuales y controles locales. | Adaptar reglas puntuales, no duplicar el módulo ni reemplazar mejoras propias de Pro3. |
| Pagos CxP | Se detectó validación y redondeo que podía perder pagos pequeños en Bs al convertirlos a USD. | PR #40 conserva monto Bs, tasa y equivalente USD con precisión subcentavo y valida mínimo Bs 0,01. |
| Corte X/Z | Había diferencias en ventana de sesión, desglose por método y conciliación entre esperado y contado. | PR #40 adapta reportes inclusivos, arqueo X temporal, arqueo Z confirmado en SQLite, métodos mixtos y estado de conciliación. |
| Devoluciones / anulaciones | Pro3 ya tiene distribución de reintegros por método y tratamiento de ventas a crédito. | Conservar esa implementación; el arqueo solo descuenta efectivo cuando existe asiento real de reintegro. |
| CxC | Pro3 ya incluye búsqueda por cliente y modal de detalle de crédito, no presentes de igual forma en Pro. | Conservar las mejoras de Pro3; deduplicar cobros históricos del libro diario por referencia. |
| Compras | Pro3 incluye deduplicación entre compras canónicas e históricas, selector de proveedores completo y filtros de rango. | Conservar; no reemplazar por la versión menos robusta de Pro. |
| Inventario | Pro3 conserva inventario local, conteo, Kardex, etiquetas y reporte de salidas periódicas. Faltaba normalización de etiquetas y recuperar filtros desde productos reales. | PR #40 normaliza acentos, mayúsculas, espacios y caracteres invisibles; agrega categorías/departamentos usados por productos reales sin sembrar datos demo. |
| Reportes e impresión | Pro3 ya tiene vista Z de 80 mm y mejoras de consolidado. | Conservar; PR #40 corrige ventana de datos y separación esperado/contado. |
| Configuración y respaldo | Pro3 tiene restauración SQLite y panel LAN; Pro usa endpoints/servicios remotos. | Mantener restauración local; PR #40 elimina topes artificiales por cantidad de filas y hace configurable el límite técnico de bytes. |
| Usuarios / control global | La lógica funcional de pantallas se conserva; cambian las llamadas de persistencia. | Adaptar a SQLite local; no copiar autenticación cloud. |
| Contabilidad, proveedores y caja | Las pantallas compartidas mantienen funciones equivalentes; la capa de persistencia difiere por arquitectura. | Revisar reglas de negocio al tocar cada módulo; mantener SQLite local. |

## Mejoras propias de Pro3 que deben preservarse

- SQLite local como única fuente de verdad operativa; nada de escrituras POS en nube ni fallback a datos demo.
- Servidor LAN con certificado/huella TLS y controles por terminal.
- Consecutivos independientes por caja y cierre Z idempotente/transaccional.
- Selección de productos fraccionados, detalle de crédito y reportes de inventario específicos.
- Restauración con backup de seguridad, validación, progreso y rollback.

## Cambios incorporados en PR #40

1. Exportación/restauración sin límites fijos de operaciones o filas; lotes solo para rendimiento.
2. Límite técnico de tamaño configurable por `POSVEN_MAX_BACKUP_BYTES` (64 MiB predeterminado); no es un límite de operaciones.
3. Pagos CxP en Bs sin perder montos cuyo equivalente USD sea menor de un centavo.
4. Ventana inclusiva de sesión X/Z, arqueo real por método, control de pagos mixtos y conciliación.
5. Exclusión de vales y ventas a crédito del efectivo; devoluciones/anulaciones solo afectan caja con asiento de reintegro real.
6. Deduplicación de cobros CxC históricos frente a referencias del libro diario.
7. Normalización de búsqueda/filtros de inventario y recuperación de filtros desde productos reales.

## Pendiente de auditoría profunda

Esta matriz es una primera comparación de los módulos y archivos comunes, no una declaración de paridad total. Antes de cerrar la tarea global se deben completar verificaciones funcionales y de regresión, módulo por módulo, sobre:

- Flujo completo de venta, pagos mixtos, ventas a crédito, abonos y reimpresión.
- Compras, recepción, costo, CxP y reversos.
- Kardex, conteo físico, ajustes, kits, productos fraccionados y salidas periódicas.
- CxC/CxP: pagos parciales/globales, referencias, notas de crédito, saldos y auditoría.
- Cortes X/Z, sesiones por terminal, devoluciones, anulaciones, caja y comprobantes.
- Contabilidad, reportes, PDF/80 mm, roles, permisos y operación LAN.

Cada diferencia se clasificará como **presente en ambos**, **ausente en Pro3**, **adaptada por arquitectura**, **no aplicable** o **requiere decisión**. No fusionar una transferencia sin pruebas del comportamiento afectado.
