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

## Auditoría ampliada de Devoluciones, CxC e Inventario (18-11-2026)

| Módulo | Diferencia comprobada | Estado |
|---|---|---|
| Devoluciones | POSVEN-Pro ofrece selección de un método general de reembolso (efectivo, mismo método o vale/crédito). POSVEN-Pro3 permite distribuir el reintegro entre varios métodos reales (USD, Bs, punto, pago móvil, Biopago, transferencia, Zelle, otros), valida que la suma coincida con el importe devuelto y conserva el desglose en el documento. Si la venta fue a crédito y no tuvo pagos efectivos, no genera reintegro ficticio. | **Mejora propia de Pro3**, conservar y cubrir con pruebas por método y pagos mixtos. |
| Anulación total | Pro3 conserva la autorización y confirmación de anulación, y maneja el reintegro por separado de la reversión de stock. La operación se ejecuta por la transacción SQLite `processReturnOrCancellationTransaction`; la UI actualiza productos, movimientos, CxC y libro diario con el resultado devuelto por el servidor. | **Adaptación SQLite presente**. Validar atomicidad e idempotencia con pruebas de integración. |
| CxC / detalle de deuda | POSVEN-Pro consulta la venta original desde el historial del módulo. POSVEN-Pro3 encapsula el detalle en `CreditDetailModal`: consulta primero la deuda autoritativa en `/api/pos/store`, resuelve la venta por `ventaId/facturaId`, y si no existe reconstruye el detalle desde los ítems persistidos en CxC. Muestra cronología de abonos. | **Equivalente y reforzado en Pro3**. La diferencia de ubicación en un componente separado no es una omisión. |
| CxC / búsqueda | POSVEN-Pro agrupa cartera por cliente; Pro3 añade búsqueda normalizada sin acentos por nombre, palabra, cédula, teléfono y dirección, sin depender de coincidencia exacta. | **Mejora propia de Pro3**. |
| Inventario / filtros | POSVEN-Pro contiene listas predeterminadas de departamentos y categorías específicas de licorería (ron, vodka, whisky, cerveza, etc.). Pro3 obtiene opciones de productos y catálogos reales, elimina caracteres invisibles, normaliza acentos y espacios y evita sembrar listas demo o datos específicos de otro comercio. | **Decisión correcta por arquitectura/producto**; no copiar catálogos rígidos del proyecto de referencia. |
| Inventario / stock y reportes | Pro3 incorpora reconciliación de stock desde Kardex, etiquetas de precios y reporte de salidas periódicas, ausentes como funciones equivalentes en el módulo revisado de Pro. | **Mejoras propias de Pro3**; conservar y probar contra SQLite. |
| Reportes X/Z | La pantalla de referencia llama al historial «Cortes Z». Pro3 lo presenta como «Consolidados de Ventas», restringe el historial a administrador y añade reimpresión en 80 mm. La lógica utiliza los registros `reportesZ`; es una diferencia de etiqueta y de presentación, no evidencia de ausencia del historial. | **Equivalente con mejoras propias**. Mantener clara la identificación del documento Z en el comprobante y en auditoría. |

## Auditoría ampliada de Contabilidad, Dashboard, Caja y Terminales (18-11-2026)

| Módulo | Diferencia comprobada | Estado |
|---|---|---|
| Contabilidad | `AccountingModule.tsx` coincide funcionalmente en las operaciones revisadas: libro diario, filtros, totales, detalle de auditoría, egresos manuales y exportación PDF. | **Equivalente**; mantener pruebas sobre asientos originados por operaciones SQLite. |
| Dashboard | Los indicadores y distribución de ventas por método se corresponden. Pro3 reemplaza el texto heredado que anunciaba sincronización Firebase por una referencia explícita a SQLite local. | **Equivalente y adaptado**. No trasladar indicadores ni conectores Firebase. |
| Caja / apertura | POSVEN-Pro modifica estado de caja directamente desde el cliente. POSVEN-Pro3 exige terminal asignada, abre mediante `Store.openCashTransaction` y solo marca la caja abierta después de recibir confirmación del servidor SQLite. | **Mejora de integridad en Pro3**; conservar la transacción central. |
| Caja / cierre | Pro3 impide cerrar la sesión desde el formulario genérico: exige ejecutar el proceso de Corte Z. No modifica la caja ni el historial si el cierre no fue confirmado por Z. | **Control más seguro en Pro3**; conservar. |
| Arqueo X/Z | Pro3 muestra siempre los métodos principales aunque tengan cero movimiento, exige conteo explícito incluso cero para Z, valida importes inválidos, advierte ventas mixtas sin desglose y distingue lectura X temporal de conciliación Z. | **Mejora de control en Pro3**; verificar con casos de arqueo parcial, sobrante, faltante y pagos mixtos. |
| Control global / terminales | Las operaciones equivalentes de crear, eliminar y asignar usuario están adaptadas en Pro3 a `/api/pos/store`, con confirmación de SQLite. La creación inicializa consecutivos independientes para recibos, CxC, CxP, devoluciones y anulaciones, además de prefijo de caja. | **Adaptación SQLite presente**. No copiar rutas `/api/turso/*` de Pro. |

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


## Auditoría de autenticación, sesiones y administración de usuarios (19-11-2026)

| Área | Hallazgo | Estado / acción |
|---|---|---|
| Contraseñas y sesiones | Pro3 conserva hash scrypt, comparación de hash en tiempo constante, token de sesión aleatorio de 256 bits, expiración de siete días, revocación y verificación del usuario bloqueado en cada lectura de sesión. | **Más controles locales presentes**; conservar. |
| Intentos de acceso | Pro3 limita intentos por identificador y dirección de origen, persiste únicamente hashes de ambos valores y aplica el contador dentro de una transacción SQLite serializada. La IP se inyecta desde el socket LAN, no desde una cabecera aportada por el cliente. | **Mejora propia de Pro3**; mantener y probar concurrencia. |
| Perímetro LAN | El proceso Electron termina TLS (mínimo TLS 1.2), valida Host contra localhost/IP LAN y puerto configurado, restringe clientes a direcciones privadas y exige Origin HTTPS coincidente en mutaciones API. El proceso Next interno escucha solo en 127.0.0.1. | **Adaptación local presente**; conservar pruebas de TLS y origen. |
| Administración de usuarios | La implementación heredada separaba bloqueo y edición de rol/nombre. Un PATCH inválido podía dejar aplicado el bloqueo y la comprobación del último administrador no cubría degradación ni eliminación; además, las lecturas previas fuera de transacción permitían carreras. | **Corregido en Pro3**: actualización y revocación de sesiones dentro de una sola transacción SQLite; protege al último administrador activo frente a bloqueo, degradación y eliminación. |
| Alta del primer administrador | createFirstAdministrator usa BEGIN IMMEDIATE y comprueba dentro de la transacción que todavía no exista administrador. | **Control presente**; conserva creación única sin cuenta semilla con contraseña predeterminada. |
| Referencia POSVEN-Pro | Pro comparte la lógica anterior de PATCH y protección de bloqueo; por tanto, la corrección se implementa como mejora de integridad específica en Pro3, no como copia literal. | **Mejora adicional de Pro3**; la arquitectura de referencia no justifica conservar el defecto. |

### Pruebas añadidas

- tests/sqlite-transaction.test.cjs: intenta degradar o eliminar al único administrador activo y comprueba el rechazo.
- La misma prueba combina edición inválida y bloqueo, verifica que no quede un cambio parcial y confirma que una actualización válida revoca el acceso de forma coherente.
- Las comprobaciones se ejecutan contra SQLite real temporal y las transacciones reales del módulo de autenticación.

La autenticación y el perímetro se han revisado a nivel de código. La matriz no marca todavía seguridad LAN completa como verificada en equipos físicos; se requiere ejecutar el instalador en Windows y probar conexiones reales de varios clientes.


**Ajuste adicional de login:** la API local ahora exige explícitamente el perfil administrador/cajero, igual que la referencia, y solo limpia el contador de intentos después de validar contraseña y perfil. Esto evita aceptar solicitudes incompletas desde clientes no UI y evita borrar intentos ante un perfil incorrecto.

La prueba de regresión también ejecuta dos degradaciones de administradores en paralelo: solo una puede completarse y siempre queda al menos un administrador activo, gracias a BEGIN IMMEDIATE y la validación dentro de la misma transacción.


## Integridad de cartera CxC y sincronización de fichas de clientes (19-11-2026)

La ruta `recordsSync` permite a cajeros sincronizar fichas de clientes, pero la implementación anterior persistía íntegramente el objeto enviado por el navegador, incluido `debt`. Ese campo es un resumen financiero derivado de las operaciones CxC y no debe poder modificarse mediante una sincronización genérica de datos maestros.

**Corrección aplicada en Pro3:** para `clientes`, `syncRecords` ahora conserva el saldo `debt` existente en SQLite al actualizar datos personales y asigna cero a un cliente nuevo. Los aumentos/disminuciones del saldo siguen perteneciendo exclusivamente a las transacciones de creación/cobro/reversión/eliminación de CxC. La operación sigue siendo atómica y devuelve al cliente el registro canónico persistido.

**Prueba de regresión:** `tests/sqlite-transaction.test.cjs` intenta elevar una deuda existente a 999999 y crear un cliente con deuda inicial 5000 mediante sincronización genérica; verifica que el saldo existente se conserve y el nuevo comience en cero, sin impedir la actualización de los datos de contacto.

La misma ruta genérica ya no permite eliminar clientes, ni siquiera con perfil administrador: exige `deleteCustomerAndDebtsTransaction`, que valida las deudas pendientes y elimina cliente e historial en una única transacción. Se añadió una prueba que intenta borrar un cliente con CxC por sincronización genérica y verifica que ambos registros permanezcan intactos.

### CxC: saldo canónico y reversión de abonos

- El alta de una deuda CxC para un cliente nuevo ahora fija `clientes.debt` al monto de la deuda registrada; no confía en el valor resumen suministrado por el cliente HTTP.
- Al reversar un abono CxC, la misma transacción SQLite restaura el saldo resumen del cliente, además de recalcular la deuda y ajustar el asiento contable. El ID del cliente actualizado se guarda en la operación para que los reintentos idempotentes recuperen el mismo resultado sin sumar dos veces.
- Se valida el tipo de cartera (`cxc`/`cxp`) antes de operar.
- Pruebas nuevas cubren creación con saldo manipulado, reversión y reintento idempotente.


### CxP: reversión de pagos subcentavo

La reversión de un abono CxP conserva seis decimales en el equivalente USD, igual que el alta del pago en Bs. No se redondea a dos decimales ni se marca como pagada una deuda que aún conserva un saldo inferior a un centavo. La prueba "reversar un pago CxP subcentavo conserva precisión de seis decimales" cubre el caso de USD 0,001 con abono de USD 0,0006.

## Auditoría adicional de respaldo y restauración SQLite (19-11-2026)

Se detectó que exportBackupSnapshot exporta todos los registros de catalogos y los declara en meta.catalogs, pero la restauración reconstruía únicamente una lista fija de catálogos. Los catálogos personalizados guardados en SQLite podían quedar fuera de la restauración aunque estuvieran presentes en el archivo.

**Corrección aplicada en Pro3:**
- La restauración incorpora también los nombres declarados en backup.meta.catalogs, además de los catálogos estándar.
- Cada catálogo declarado en el manifiesto debe existir como lista y su conteo debe coincidir exactamente; un manifiesto incompleto o inconsistente se rechaza antes de modificar SQLite.
- Se rechazan nombres de catálogo reservados por el formato de respaldo para impedir que un catálogo sobrescriba tablas, usuarios o configuración.
- La restauración valida identificadores no vacíos y rechaza IDs duplicados dentro de cada tabla antes de iniciar el reemplazo de datos. Así se evita que un UPSERT silencioso convierta dos filas del respaldo en una sola.
- El conteo informativo totalRows no suma dos veces el alias histórico caja cuando el respaldo ya contiene cashHistory.

**Prueba añadida:** crea un respaldo con un catálogo personalizado, verifica que un respaldo con IDs duplicados sea rechazado sin borrar un producto local y después restaura el archivo válido comprobando la recuperación del catálogo personalizado y del producto. La prueba corre sobre SQLite temporal real y también fuerza un error SQL después de iniciar el reemplazo para comprobar que el rollback restaura los datos previos. El resultado final debe confirmarse con los workflows de TypeScript y compilación Windows.

**Pendiente de auditoría:** comprobar la coherencia de catálogos con nombres reservados en respaldos históricos y la recuperación/decisión de usuarios con colisiones. El rollback ante un fallo SQL intermedio ya tiene prueba de regresión.


### CxC: conciliación del saldo resumen en cobros globales

La auditoría detectó que el cobro global actualizaba el saldo de la deuda CxC, el historial de pagos y el asiento, pero solo descontaba el resumen financiero del cliente cuando la llamada incluía su cédula. Las deudas históricas registradas únicamente por nombre podían quedar con el saldo resumen del cliente desactualizado.

**Corrección aplicada:** el cobro global busca primero por cédula y, si no encuentra ficha vinculada, por nombre exacto sin distinguir mayúsculas/minúsculas. Si encuentra exactamente un cliente, descuenta el cobro aplicado en la misma transacción SQLite. Si encuentra homónimos, aborta la operación completa para no modificar la ficha equivocada.

**Pruebas añadidas:** cobro por nombre actualiza deuda CxC y resumen del cliente; clientes homónimos provocan rollback sin alterar deuda ni fichas. Se conservan las reglas de caja: el cobro CxC puede quedar vinculado a terminal, mientras el pago global CxP sigue siendo administrativo y no depende de caja.


### Compras: stock y costo ponderado coherentes al registrar

Se detectó que la transacción de compra persistía el stock y el costo CPP en SQLite, pero devolvía `products: []` porque nunca agregaba los productos actualizados al resultado. El módulo Compras solo actualiza su estado visual con esa respuesta, por lo que el inventario podía verse desactualizado hasta una recarga.

**Correcciones aplicadas:**
- La transacción devuelve los productos realmente actualizados, también en la recuperación idempotente.
- La cantidad debe ser positiva y finita; el costo unitario y el subtotal deben ser finitos y no negativos; cada línea debe identificar un producto.
- Cuando una factura contiene varias líneas del mismo producto con costos distintos, el movimiento de Kardex usa el costo unitario ponderado por cantidades, y el CPP incorpora el valor total real de las líneas.
- Se rechaza un identificador de movimiento ya existente en Kardex para impedir sobrescrituras silenciosas.

**Pruebas añadidas:** compra con dos líneas del mismo producto y costos distintos, respuesta con stock actualizado, costo ponderado, Kardex consolidado y reintento idempotente; compra con cantidad negativa rechazada sin alterar inventario ni historial. El cobro individual CxC también resuelve ficha por nombre exacto si no hay cédula disponible; si hay homónimos, revierte todo el cobro. Se cubren ambos escenarios con pruebas SQLite.
