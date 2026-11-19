# Auditoría de paridad POSVEN-Pro → POSVEN-Pro3

**Corte de comparación:** 18-11-2026  
**Referencia funcional:** `fenixlife1978/posven-pro`, rama `main`  
**Destino:** `fenixlife1978/Posven-pro3`, rama de trabajo `feat/posven-pro3-parity-unlimited-backups` (PR #40; sin fusionar)

## Principio de adaptación

POSVEN-Pro sirve como referencia para descubrir reglas de negocio y mejoras. POSVEN-Pro3 conserva SQLite local como única fuente operativa, transacciones atómicas, operación LAN y aislamiento por terminal. No se copian Turso, Firebase/Firestore, autenticación remota ni colas de sincronización como autoridad de datos.

## Diferencias identificadas

| Área | Estado en POSVEN-Pro3 | Acción / criterio |
|---|---|---|
| POS / ventas | La lógica de `PosModule.tsx` de Pro está integrada en `SalesModule.tsx`; Pro3 ya añade selección fraccionada, detalle CxC, movimientos manuales y controles locales. | Adaptar reglas puntuales, no duplicar el módulo ni reemplazar mejoras propias de Pro3. |
| Pagos CxP | Se detectó validación y redondeo que podía perder pagos pequeños en Bs al convertirlos a USD. | PR #40 conserva monto Bs, tasa y equivalente USD con precisión subcentavo y valida mínimo Bs 0,01. |
| Corte X/Z | Había diferencias en ventana de sesión, desglose por método y conciliación entre esperado y contado. | PR #40 adapta reportes inclusivos, arqueo X temporal, arqueo Z confirmado en SQLite, métodos mixtos y estado de conciliación. |
| Devoluciones / anulaciones | Pro3 ya tiene distribución de reintegros por método y tratamiento de ventas a crédito. | Conservar esa implementación; el arqueo solo descuenta efectivo cuando existe asiento real de reintegro. |
| CxC | Pro3 ya incluye búsqueda por cliente y el componente `CreditDetailModal`, que muestra la venta original y la cronología de abonos; la pantalla CxC lo invoca desde el historial del cliente. | **Equivalente mediante otra implementación** respecto al detalle de deuda de Pro. Conservar la búsqueda adicional de Pro3 y deduplicar cobros históricos del libro diario por referencia. |
| Compras | Pro3 incluye deduplicación entre compras canónicas e históricas, selector de proveedores completo y filtros de rango. | Conservar; no reemplazar por la versión menos robusta de Pro. |
| Inventario | Pro3 conserva inventario local, conteo, Kardex, etiquetas y reporte de salidas periódicas. Faltaba normalización de etiquetas y recuperar filtros desde productos reales. | PR #40 normaliza acentos, mayúsculas, espacios y caracteres invisibles; agrega categorías/departamentos usados por productos reales sin sembrar datos demo. |
| Reportes e impresión | Pro3 ya tiene vista Z de 80 mm y mejoras de consolidado. | Conservar; PR #40 corrige ventana de datos y separación esperado/contado. |
| Configuración y respaldo | Pro3 tiene restauración SQLite y panel LAN; faltaba la importación exclusiva de catálogos que tenía Pro. | PR #40 agrega importación local de catálogos con vista previa, confirmación admin y fusión transaccional; también elimina topes artificiales por cantidad de filas y hace configurable el límite técnico de bytes. |
| Usuarios / control global | La lógica funcional de pantallas se conserva; cambian las llamadas de persistencia. | Adaptar a SQLite local; no copiar autenticación cloud. |
| Contabilidad, proveedores y caja | Las pantallas compartidas mantienen funciones equivalentes; la capa de persistencia difiere por arquitectura. | Revisar reglas de negocio al tocar cada módulo; mantener SQLite local. |

## Comparación estructural de repositorios (revisión 18-11-2026)

Se compararon los árboles completos de archivos de ambas ramas: POSVEN-Pro `main` (133 archivos) y POSVEN-Pro3 en la rama de trabajo de PR #40 (144 archivos). Se encontraron 113 rutas compartidas. Esta comparación estructural sirve para orientar la auditoría, pero **la coincidencia o diferencia de rutas no demuestra por sí sola paridad funcional**.

### Elementos exclusivos de POSVEN-Pro revisados

| Elemento | Hallazgo | Clasificación / decisión |
|---|---|---|
| `src/components/pos/PosModule.tsx` | El flujo POS de referencia está integrado en `src/components/modules/SalesModule.tsx` en Pro3, que además contiene funciones propias. | **Equivalente mediante otra implementación**. Seguir comparando reglas y casos de uso; no duplicar el módulo. |
| `src/lib/offline-queue.ts` | Cola durable basada en IndexedDB del navegador, procesada cuando vuelve la conexión. En POSVEN-Pro, `db-store.ts` la utiliza para encolar operaciones de inventario y el procesador las envía a la persistencia remota/Turso. | **No aplicable en su forma actual**. POSVEN-Pro3 centraliza la autoridad en SQLite del servidor LAN. Replicar una cola de escrituras autónoma en cada cliente podría aceptar cambios sin validación central y provocar conflictos de stock. No importar IndexedDB ni la sincronización Turso. Si se requiere tolerancia a desconexiones LAN, diseñar por separado un protocolo local con IDs idempotentes, validación y conciliación contra SQLite; no asumir que la cola web es transferible. |
| `src/lib/turso/*`, `src/app/api/turso/*`, `src/lib/auth/turso-auth.ts`, archivos Firebase/Firestore y configuración App Hosting | Son implementación de infraestructura cloud y persistencia del repositorio de referencia. | **No aplicable por arquitectura**. Pro3 usa SQLite local; no trasladar endpoints, secretos ni dependencias. |
| `docs/migracion-turso.md` y `docs/auditoria-persistencia-pre-turso.md` | Documentación de la arquitectura histórica/remota del proyecto de referencia. | **No aplicable como implementación**. Solo consultar si ayuda a entender reglas funcionales; nunca usarla para cambiar la arquitectura de Pro3. |

### Elementos exclusivos de POSVEN-Pro3 que se deben conservar

- `src/components/pos/FractionalProductSelectorModal.tsx`: selección de presentaciones/productos fraccionados.
- `src/components/pos/ZReportPreview80mm.tsx`: vista e impresión de reporte Z de 80 mm.
- `src/components/modules/CreditDetailModal.tsx`: detalle de crédito.
- `src/components/inventory/PriceLabelsModal.tsx`: etiquetas de precios.
- `src/components/modules/PeriodicInventoryExitsReport.tsx`: reporte de salidas periódicas.
- `src/components/modules/CxCModule.tsx` + `CreditDetailModal`: búsqueda de cartera y consulta del documento original/cronología de abonos; no se considera una omisión aunque el modal esté separado en otro archivo.
- `src/lib/sqlite/*`, servidor LAN y pruebas de transacciones/instalador: infraestructura propia que no debe reemplazarse por la del repositorio de referencia.

### Diferencias de comportamiento observadas en POS / inventario

- La comparación de `SalesModule.tsx` confirma que Pro3 contiene el flujo de ventas integrado y ampliado: mantiene la lógica de pagos/abonos, X/Z, devoluciones/anulaciones y ajustes; además incorpora consulta de detalles de crédito, lectura posterior de saldos desde SQLite y movimientos de caja. No se detectó una función POS exclusiva de Pro que justifique copiar el archivo completo.
- Los módulos de inventario comparten catálogo, valorización, ajustes, Kardex, ventas, devoluciones y consumo/colaboraciones. Pro3 añade sincronización de stock desde Kardex, normalización de etiquetas, etiquetas imprimibles y reporte de salidas periódicas. Los ajustes deben seguir validándose con pruebas funcionales y no solo por coincidencia de componentes.
- El panel de control global conserva creación/eliminación de terminales y asignación de usuarios en ambos repositorios; en Pro3 las operaciones persisten en SQLite local en lugar de Turso.

## Auditoría ampliada de Compras, CxP, Reportes y Configuración (18-11-2026)

### Diferencias verificadas

| Módulo | Diferencia comprobada | Estado |
|---|---|---|
| Compras | POSVEN-Pro concatena compras reconstruidas desde movimientos históricos y compras registradas, sin deduplicación entre ambas fuentes. POSVEN-Pro3 usa una clave compuesta por fecha + número de factura + proveedor (o ID si faltan datos) y da prioridad al registro canónico de SQLite sobre la reconstrucción de Kardex. | **Mejora ya integrada en Pro3**. Evita duplicar compras en el historial y conserva el registro canónico. |
| Compras / filtros | POSVEN-Pro ofrece proveedores del historial. POSVEN-Pro3 combina el catálogo real de proveedores con los proveedores históricos, normaliza la búsqueda y admite rangos de fecha vacíos; al cambiar rango reinicia la paginación. | **Mejora ya integrada en Pro3**. |
| CxP / pago individual | POSVEN-Pro convierte directamente Bs a USD y compara con una tolerancia fija de USD 0,001. POSVEN-Pro3 valida tasa positiva, conserva monto Bs a dos decimales, calcula USD con seis decimales para pagos Bs, compara el saldo en Bs redondeado a céntimos y el saldo USD a centavos para pagos USD. | **Mejora ya integrada en Pro3**. Protege pagos pequeños en Bs cuyo equivalente USD es inferior a un centavo. |
| Reportes | POSVEN-Pro presenta historial de Cortes Z con datos resumidos. POSVEN-Pro3 añade restricción del historial a administrador, reimpresión del consolidado en impresora térmica de 80 mm y una visualización de equivalencia Bs que evita inventar conversión cuando no existe dato histórico suficiente. | **Mejora propia de Pro3**. Conservar. |
| Usuarios | Los módulos revisados mantienen las mismas operaciones de alta, edición, bloqueo y eliminación; las rutas de API de Pro3 están respaldadas por la autenticación/SQLite local. | **Equivalente**; mantener pruebas de autorización en servidor. |
| Proveedores | Los formularios revisados coinciden en validación de RIF, prevención de duplicados, actualización de nombre en productos y confirmación de eliminación. | **Equivalente**; no requiere copiar. |
| Configuración | Pro3 adapta respaldo/restauración, importación exclusiva de catálogos y formateo a SQLite local; agrega configuración de red LAN y selector de archivo mediante Electron. Las referencias de reparación/importación de datos migrados y los metadatos Turso en respaldos se conservan únicamente para compatibilidad histórica, con endpoints locales `/api/pos/*`. | **Adaptación local ya presente**. Auditar nombres heredados por claridad, sin romper importación de respaldos antiguos. |

### Observación de alcance

La revisión confirma que no se debe asumir que una diferencia de código equivale a una mejora pendiente. En estos módulos, POSVEN-Pro3 ya incluye adaptaciones o funciones adicionales. No se copió código cloud del repositorio de referencia. Los flujos indicados se han comparado a nivel de implementación; todavía deben verificarse con pruebas funcionales de integración y datos límite antes de marcar paridad global.

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
7. Normalización de búsqueda/filtros de inventario y recuperación de filtros desde productos reales.\n8. Importación exclusiva de departamentos/categorías con vista previa y fusión SQLite sin tocar inventario ni operaciones.

## Pendiente de auditoría profunda

Esta matriz es una comparación estructural y funcional inicial de los módulos revisados, no una declaración de paridad total. Antes de cerrar la tarea global se deben completar verificaciones funcionales y de regresión, módulo por módulo, sobre:

- Flujo completo de venta, pagos mixtos, ventas a crédito, abonos y reimpresión.
- Compras, recepción, costo, CxP y reversos.
- Kardex, conteo físico, ajustes, kits, productos fraccionados y salidas periódicas.
- CxC/CxP: pagos parciales/globales, referencias, notas de crédito, saldos y auditoría.
- Cortes X/Z, sesiones por terminal, devoluciones, anulaciones, caja y comprobantes.
- Contabilidad, reportes, PDF/80 mm, roles, permisos y operación LAN.

Cada diferencia se clasificará como **presente en ambos**, **ausente en Pro3**, **adaptada por arquitectura**, **no aplicable** o **requiere decisión**. No fusionar una transferencia sin pruebas del comportamiento afectado.
