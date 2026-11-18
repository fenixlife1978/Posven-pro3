# AGENTS.md — POSVEN-Pro3

## Objetivo permanente
POSVEN-Pro3 debe conservar la arquitectura de escritorio **SQLite local + servidor LAN** y alcanzar la paridad funcional con el repositorio de referencia `fenixlife1978/posven-pro`. El repositorio de referencia es una fuente para descubrir y trasladar mejoras de negocio, validaciones, cálculos, reportes, UX y correcciones; **no** es una autorización para copiar su infraestructura de nube/Turso/Firebase ni sus mecanismos de persistencia.

## Comparación continua con POSVEN-Pro
- Antes de cerrar una tarea, comparar el comportamiento afectado en `fenixlife1978/posven-pro` (rama `main`) con `fenixlife1978/Posven-pro3` (rama `main`).
- Identificar funciones, reglas de negocio, validaciones, cálculos, controles, reportes, impresión, accesibilidad, rendimiento y correcciones que existan en POSVEN-Pro y estén ausentes o sean inferiores en POSVEN-Pro3.
- Mantener un inventario verificable de diferencias: **presente en ambos**, **ausente en Pro3**, **adaptado por arquitectura**, **no aplicable** o **requiere decisión**. No asumir que una función falta solo porque cambió de nombre o ubicación.
- Trasladar a POSVEN-Pro3 toda mejora compatible y útil, adaptando su implementación a SQLite local, transacciones SQLite, sesiones locales, servidor LAN y controles por terminal/rol.
- No copiar dependencias ni código de Firebase, Firestore, RTDB, Turso o servicios remotos como autoridad operativa. No introducir sincronización cloud ni convertir cachés locales en fuente de verdad.
- Preservar las mejoras propias de POSVEN-Pro3 aunque no existan en POSVEN-Pro: SQLite como única fuente operativa, operación LAN, idempotencia, aislamiento de cajas, transacciones atómicas y seguridad local.
- Añadir pruebas de regresión para cada regla de negocio trasladada y para los defectos encontrados durante la comparación.

## Respaldos y restauración: sin límites artificiales de operaciones
- Exportar y restaurar todos los registros existentes de todas las tablas y catálogos incluidos en el formato de respaldo, sin topes fijos por cantidad de operaciones, movimientos, ventas, filas o registros.
- No introducir límites como 10.000, 100.000 o 200.000 registros. Los tamaños de lote solo controlan el rendimiento de inserción; nunca deben truncar, omitir ni rechazar registros por su cantidad.
- La exportación debe consultar el conjunto completo y declarar conteos reales en el manifiesto. No marcar un respaldo como completo si alguna tabla, página o catálogo falló o quedó sin leer.
- La restauración debe validar estructura, IDs, duplicados, relaciones, conteos y consistencia antes de reemplazar datos; preservar respaldo de seguridad, transacción atómica, rollback, integridad SQLite y verificación posterior.
- Procesar en lotes cuando sea necesario para memoria, tiempo de respuesta y parámetros SQL, informando progreso real. Los lotes no pueden dejar una restauración parcial como si fuera completa.
- Se permiten límites técnicos de tamaño de archivo, memoria, tiempo o concurrencia para proteger la instalación, pero deben ser explícitos, configurables/documentados y no confundirse con límites de cantidad de operaciones. Ante un límite técnico, cancelar de forma segura y explicar la causa sin modificar la base destino.
- No inferir truncamiento únicamente porque una tabla tenga exactamente 10.000 filas. Detectar truncamiento mediante evidencia explícita de paginación/manifestación incompleta o error de lectura; los respaldos históricos sin metadatos suficientes deben tratarse con cautela y confirmación clara, sin afirmar como hecho que faltan registros.
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
- Un conteo de exactamente 10.000 filas en un respaldo Turso antiguo es una señal de posible límite histórico, no prueba de truncamiento. Mostrar advertencia y pedir confirmación; no afirmar que faltan registros sin evidencia adicional.
