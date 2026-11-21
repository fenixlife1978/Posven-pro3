# AGENTS.md — POSVEN-Pro3

## Objetivo permanente
POSVEN-Pro3 es exclusivamente un **software de escritorio para Windows**, construido con Electron + Next.js local y **SQLite local como única base de datos y fuente de verdad**. El equipo servidor aloja el archivo SQLite y expone la API autenticada únicamente a clientes de la red LAN. POSVEN-Pro3 **no usa, no debe usar ni debe depender de Turso, Firebase, Firestore, Vercel ni de una base de datos cloud** para operar. No configurar despliegues Vercel ni tratar Vercel como plataforma de ejecución de este producto. Alcanzar la paridad funcional con el repositorio de referencia `fenixlife1978/posven-pro`. El repositorio de referencia es una fuente para descubrir y trasladar mejoras de negocio, validaciones, cálculos, reportes, UX y correcciones; **no** es una autorización para copiar su infraestructura de nube/Turso/Firebase ni sus mecanismos de persistencia.

## Comparación continua entre los repositorios POSVEN-Pro y POSVEN-Pro3

La tarea estratégica permanente de POSVEN-Pro3 es comparar sistemáticamente los repositorios `fenixlife1978/posven-pro` (POSVEN-Pro, proyecto de referencia) y `fenixlife1978/Posven-pro3` (POSVEN-Pro3, producto de escritorio) para descubrir y trasladar las mejoras que tenga POSVEN-Pro y que todavía no existan en POSVEN-Pro3.

- La comparación abarca **los repositorios completos y todos sus módulos**, no solo el archivo o módulo que se esté modificando. Revisar periódicamente nuevas funciones, correcciones, reglas de negocio, validaciones, cálculos, reportes, impresión, UX, accesibilidad, rendimiento, seguridad y pruebas incorporadas en POSVEN-Pro.
- Para cada diferencia, verificar el comportamiento y el código de ambos repositorios. Identificar expresamente qué aporta POSVEN-Pro, comprobar si POSVEN-Pro3 ya ofrece una solución equivalente y registrar el resultado. No confundir diferencias de nombres, organización o tecnología con funciones ausentes.
- Toda mejora útil que esté en POSVEN-Pro y falte en POSVEN-Pro3 debe convertirse en una tarea de adaptación e integración en POSVEN-Pro3. **La comparación no termina al elaborar una lista: su propósito es implementar en POSVEN-Pro3 las mejoras aplicables**, probarlas y cerrar su seguimiento.
- Antes de integrar, evaluar compatibilidad, impacto en datos y seguridad. Adaptar la lógica al producto destino: aplicación de escritorio Windows con Electron + Next.js local, SQLite local como única base de datos y fuente de verdad, servidor LAN autenticado y operación local. No copiar ciegamente arquitectura, dependencias, endpoints ni persistencia del proyecto de referencia.
- No importar ni introducir dependencias operativas de Turso, Firebase, Firestore, Vercel, bases de datos cloud o servicios remotos. Las mejoras de POSVEN-Pro deben conservar su valor funcional al ser reimplementadas con la arquitectura local de POSVEN-Pro3. Los servicios externos opcionales nunca pueden ser requisito para ventas, inventario, caja ni otras operaciones esenciales.
- Clasificar cada elemento en la matriz como **presente en ambos**, **mejora detectada en POSVEN-Pro y pendiente en Pro3**, **integrado y verificado en Pro3**, **equivalente mediante otra implementación**, **no aplicable por arquitectura/producto** o **requiere decisión**. Registrar referencia de origen, módulo afectado, descripción, decisión, archivos destino, pruebas y estado.
- Priorizar y ejecutar las mejoras pendientes de forma ordenada, comenzando por la tarea pendiente más antigua y respetando dependencias. Agrupar cambios relacionados cuando sea seguro, sin dejar hallazgos conocidos abandonados.
- Después de cada integración, añadir pruebas de regresión que demuestren la mejora y protejan el comportamiento existente; ejecutar las pruebas pertinentes, TypeScript y build, corregir fallos y repetir. Para cambios de Electron/instalador, verificar también el workflow de Windows y distinguir CI de pruebas físicas.
- Mantener `docs/PARIDAD-POSVEN-PRO3.md` como registro vivo de la comparación entre ambos repositorios. Actualizarlo al descubrir diferencias, decidir adaptaciones, integrar mejoras y completar verificaciones. La auditoría debe continuar en futuras tareas hasta reducir y justificar las diferencias; nunca declarar paridad total sin evidencia por módulo.
- POSVEN-Pro es una **fuente de mejoras funcionales**, no una autoridad para cambiar la arquitectura de POSVEN-Pro3. Preservar también las capacidades propias de POSVEN-Pro3, como SQLite local, operación LAN, idempotencia, aislamiento de cajas, transacciones atómicas y seguridad local.

## Respaldos y restauración: sin límites artificiales de operaciones
- Exportar y restaurar todos los registros existentes de todas las tablas y catálogos incluidos en el formato de respaldo, sin topes fijos por cantidad de operaciones, movimientos, ventas, filas o registros.
- No introducir límites como 10.000, 100.000 o 200.000 registros. Los tamaños de lote solo controlan el rendimiento de inserción; nunca deben truncar, omitir ni rechazar registros por su cantidad.
- La exportación debe consultar el conjunto completo y declarar conteos reales en el manifiesto. No marcar un respaldo como completo si alguna tabla, página o catálogo falló o quedó sin leer.
- La restauración debe validar estructura, IDs, duplicados, relaciones, conteos y consistencia antes de reemplazar datos; preservar respaldo de seguridad, transacción atómica, rollback, integridad SQLite y verificación posterior.
- Procesar en lotes cuando sea necesario para memoria, tiempo de respuesta y parámetros SQL, informando progreso real. Los lotes no pueden dejar una restauración parcial como si fuera completa.
- Se permiten límites técnicos de tamaño de archivo, memoria, tiempo o concurrencia para proteger la instalación, pero deben ser explícitos, configurables/documentados y no confundirse con límites de cantidad de operaciones. Ante un límite técnico, cancelar de forma segura y explicar la causa sin modificar la base destino.
- No inferir truncamiento únicamente porque una tabla tenga exactamente 10.000 filas. Detectar truncamiento mediante evidencia explícita de paginación/manifiesto incompleto o error de lectura; los respaldos históricos importados de POSVEN2 sin metadatos suficientes deben tratarse con cautela y confirmación clara, sin afirmar como hecho que faltan registros. La lectura de metadatos de respaldos heredados no autoriza ni implica conexión a servicios cloud.
- Probar exportación y restauración con volúmenes superiores a los antiguos topes, registros en tablas grandes, duplicados, archivos corruptos, fallo a mitad de restauración y rollback.

## Flujo de trabajo obligatorio
1. Resolver primero la tarea pendiente más antigua. No saltar a tareas nuevas dejando una antigua sin cerrar.
2. Auditar el código y las pruebas actuales antes de modificar. Revisar también diferencias relevantes con POSVEN-Pro.
3. Implementar el cambio completo, añadir/actualizar pruebas, ejecutar pruebas, TypeScript y build; corregir fallos y repetir hasta que pasen.
4. Para cambios de instalador o comportamiento Electron, ejecutar también el workflow de Windows installer. Distinguir siempre entre CI y pruebas físicas en Windows; no afirmar pruebas físicas que no se hayan realizado.
5. Crear PR hacia `main`, verificar todos los checks y revisar el diff final. Integrar/fusionar solo después de verificaciones satisfactorias; confirmar el SHA de merge y comprobar que los cambios están realmente en `main`.
6. No dejar ramas de trabajo ni PR antiguos abandonados: cerrar/fusionar cada tarea verificada antes de avanzar cronológicamente a la siguiente.
7. **No desplegar en Vercel ni publicar producción** salvo autorización explícita del usuario. No usar Preview como sustituto.
8. No declarar una función terminada basándose solo en que compila; comprobar sus rutas de ejecución y resultados con pruebas apropiadas.
9. Mantener datos reales y trazabilidad; no introducir datos demo, mocks operativos ni resultados ficticios.

## Reglas funcionales de paridad POS / Caja
- Los pagos CxP en bolívares deben conservar los centavos de Bs aunque su equivalente USD sea menor a USD 0,01. Guardar tasa aplicada, monto BS y equivalente USD con precisión suficiente; no validar ni liquidar exclusivamente con centavos USD.
- Los cobros globales CxC/CxP deben deduplicar asientos del libro diario frente a recibos/ventas por referencia; incluir asientos históricos sin documento asociado una sola vez y respetar el desglose de pagos mixtos.
- Los reportes X/Z deben usar la sesión activa de la terminal y una ventana de fechas inclusiva en la marca temporal de apertura/último Z. Cargar ventas, devoluciones, anulaciones y libro diario del período completo.
- El arqueo X es informativo y temporal: nunca persiste conteos ni cierra la caja. El arqueo Z exige un valor real para cada método, incluso cero, bloquea ventas mixtas sin desglose y solo cierra tras confirmación SQLite.
- En Z, separar siempre el monto esperado por el sistema del monto físico contado. Persistir el contado en la sesión cerrada y mostrar en el comprobante si hubo conciliación, faltante, sobrante o ausencia de arqueo real.
- Devoluciones/anulaciones solo afectan el efectivo del método realmente reintegrado cuando exista evidencia en el libro diario. No inventar salidas desde el método original de venta. Los vales/notas de crédito y ventas a crédito no son efectivo.
- Normalizar métodos de pago históricos y clasificar movimientos manuales por categoría/tipo, excluyendo ventas, cobros CxC, devoluciones y anulaciones para evitar doble contabilización.
- Un conteo de exactamente 10.000 filas en un respaldo heredado de POSVEN2 es una señal de posible límite histórico, no prueba de truncamiento. Mostrar advertencia y pedir confirmación; no afirmar que faltan registros sin evidencia adicional. Esta compatibilidad de importación no conecta POSVEN3 a la base de datos ni al servicio de origen.

- Las pruebas automatizadas deben descubrirse solo desde `tests/*.test.cjs` mediante `scripts/run-tests.cjs`, compatible con Windows y Linux. Los scripts auxiliares de `scripts/` no deben ejecutarse como pruebas por descubrimiento automático.

- Los filtros de inventario deben normalizar acentos, mayúsculas, espacios y caracteres invisibles; además deben ofrecer categorías/departamentos presentes en productos reales aunque falten en las tablas de catálogo. No sembrar catálogos demo ni recuperar listas históricas específicas de otro comercio como valores predeterminados.

- Mantener actualizado `docs/PARIDAD-POSVEN-PRO3.md` con la matriz de diferencias, decisiones de adaptación y pendientes de auditoría. No declarar paridad total hasta completar y probar cada módulo.

- La importación de catálogos desde respaldo exclusivo debe ofrecer vista previa, exigir administrador y confirmación explícita, fusionar sin duplicados en una transacción SQLite y no modificar productos, stock, movimientos, ventas, compras, CxC/CxP ni caja.

## Exclusión total de Vercel

POSVEN-PRO3 **no necesita Vercel y no debe utilizarlo bajo ninguna circunstancia como parte de su ciclo de vida**. Es una aplicación de escritorio Windows con Electron, Next.js ejecutado localmente y SQLite local. Por tanto:

- No desplegar, publicar, alojar, ejecutar, compilar ni probar POSVEN-PRO3 en Vercel.
- No crear deployments Preview ni Production, no usar Vercel CLI, APIs, tokens, variables, proyectos, dominios, cron jobs ni servicios de Vercel para este producto.
- No considerar los avisos, fallos, límites diarios, checks ni comentarios del bot de Vercel como bloqueos de POSVEN-PRO3. Ignorarlos en la evaluación de calidad del producto; no gastar tiempo intentando corregirlos.
- La presencia accidental de una integración GitHub/Vercel o de un check externo no convierte a Vercel en dependencia. No adaptar código ni arquitectura para satisfacerla.
- La compilación, pruebas y empaquetado se realizan localmente o mediante GitHub Actions compatibles con Windows, sin despliegues externos. Los artefactos instalables se generan y distribuyen por los mecanismos autorizados del proyecto.
- No solicitar autorización para evitar Vercel ni detener el trabajo por advertencias de Vercel: su exclusión es una decisión arquitectónica permanente ya establecida.

## Alcance funcional confirmado por el usuario — POSVEN2 → POSVEN-PRO3 (20-11-2026)

El encargo de esta etapa es comparar el comportamiento real de POSVEN2 (fenixlife1978/posven-pro) con POSVEN-PRO3 (fenixlife1978/Posven-pro3) e implementar en POSVEN-PRO3 las funciones que existan en POSVEN2 y estén ausentes, incompletas o se comporten de forma distinta. La meta es entregar la versión corregida 3.0.1 y su instalador Windows .exe.

- La referencia funcional es POSVEN2; el producto que se modifica es POSVEN-PRO3. Auditar ambos repositorios directamente, módulo por módulo y proceso por proceso.
- La comparación debe cubrir navegación y menú, pantallas, botones, acciones, formularios, validaciones, reglas de negocio, cálculos, permisos, reportes, impresión, mensajes y rutas completas de ejecución (UI, API, persistencia y pruebas).
- No basta con comparar nombres de archivos ni elaborar una lista. Cada diferencia funcional comprobada debe resolverse en POSVEN-PRO3 cuando sea aplicable, adaptándola a Electron + Next.js local + SQLite local y operación autenticada por LAN.
- Seguir el orden real de navegación/menú de POSVEN2, comenzando por el primer módulo y avanzando cronológicamente. Registrar cada módulo antes de pasar al siguiente; no saltar hallazgos antiguos ni dejar defectos confirmados sin decisión.
- Para cada módulo, registrar en docs/PARIDAD-POSVEN-PRO3.md: origen POSVEN2, implementación equivalente en POSVEN-PRO3, botones/acciones y casos de uso comparados, diferencias concretas, clasificación, archivos afectados, pruebas necesarias, resultado de ejecución y estado. Distinguir equivalente de ausente con evidencia de código y pruebas.
- Implementar únicamente paridad funcional con POSVEN2 y ajustes técnicos indispensables para que esa paridad opere correctamente en la arquitectura de escritorio. No agregar módulos, motores, procesos contables ni capacidades nuevas que no formen parte del comportamiento existente en POSVEN2.
- NO desarrollar un motor independiente de reconstrucción cronológica del CPP ni ampliar el alcance contable. Los cambios de CPP/Kardex solo se justifican si la comparación demuestra una diferencia funcional real respecto de POSVEN2 o si son necesarios para corregir un defecto dentro de una función existente que se está igualando. No convertir hallazgos de costos en un proyecto separado.
- Las correcciones ya integradas y verificadas en POSVEN-PRO3 se conservan; no revertirlas por esta rectificación de alcance.
- No copiar infraestructura de POSVEN2. SQLite local sigue siendo la única fuente de verdad de POSVEN-PRO3; no introducir Turso, Firebase, Firestore, nube ni Vercel.
- Agrupar los cambios por módulo cuando sea seguro. Añadir pruebas de regresión, ejecutar suite, TypeScript, build y workflow de instalador Windows; corregir y repetir los checks fallidos. Fusionar PRs solo con verificaciones satisfactorias y SHA esperado confirmado.
- No trabajar en Linux para este repositorio ni usar Vercel en ninguna fase. Utilizar GitHub Actions compatibles con Windows y las verificaciones disponibles del proyecto.
- Al completar toda la matriz y verificar la paridad, actualizar versión a 3.0.1, producir y validar el instalador Windows .exe y publicar GitHub Release v3.0.1 con el artefacto y notas. La autorización para esa Release aplica únicamente cuando la auditoría, correcciones, pruebas e instalador estén completos; no publicar antes.


## Registro de avance de auditoría POSVEN2 → POSVEN-PRO3 (21-11-2026)

### Módulos revisados en esta ronda
- [x] Inventario: correcciones de paginación y carga de catálogo completo integradas (PR #65 y #66); CI Windows y artefacto de instalador verificados.
- [x] Ventas/POS: comparación estática de módulo principal, modales de cobro/crédito y devoluciones; no se encontró omisión estática. Falta validación manual completa en Windows con scanner/impresora y casos reales.
- [x] Entradas/Compras: comparación estática; flujo, deuda CxP, asiento y entrada de stock conservados, Pro3 mantiene precisión/filtros/deduplicación.
- [x] Proveedores: handlers y labels principales comparados; no se observó diferencia funcional.
- [x] Contabilidad: handlers/acciones comparados; diferencias sintácticas menores sin cambio de función.
- [x] CxC: revisión estática; detalle inline de POSVEN2 encapsulado en CreditDetailModal de Pro3, con paginación/búsqueda adicional.
- [x] CxP: handlers y acciones de pagos individuales/globales, liquidación cronológica, cronología y deuda directa comparados.
- [x] Reportes: Pro3 conserva ventas, Z, PDF e impresión y añade métodos de pago, costos históricos faltantes, equivalencia Bs y reimpresión.
- [x] Configuración: revisada; respaldos/restauración, catálogos, seguridad, datos empresa y reparaciones adaptados a SQLite local; se añadió LAN.
- [x] Usuarios: handlers principales de creación/edición/bloqueo/eliminación comparados.
- [x] Global Control: terminales y gestión de identidades/operadores comparados.
- [x] Dashboard: comparación estática de los resúmenes y acciones principales.

### Estado de evidencia (no confundir con cierre de pruebas manuales)

Las casillas anteriores significan **revisión estática comparativa inicial**, no certificación exhaustiva de cada flujo con datos reales ni pruebas manuales de hardware. La auditoría de paridad funcional detallada sigue abierta hasta:
1. Profundizar en casos de extremo a extremo POS, devoluciones/anulaciones, cobros y arqueo X/Z, CxC/CxP, compras, reportes e importación/restauración.
2. Convertir cada diferencia/defecto descubierto en corrección y prueba automatizada, ejecutar workflows Windows y verificar artefacto de instalador.
3. Auditar casos límite, permisos y transacciones (duplicados, doble envío, datos históricos incompletos, reversión, fallos de SQLite y concurrencia LAN).
4. Completar la matriz de pruebas por módulo y resolver cualquier brecha antes de versionar 3.0.1.

PRs de documentación integrados durante esta ronda: #67 (Inventario/Ventas), #68 (Compras), #69 (Proveedores/Finanzas), #70 (Reportes/Configuración/Administración). La auditoría funcional no se considera finalizada y no se autoriza publicar v3.0.1 hasta completar la evidencia pendiente.
