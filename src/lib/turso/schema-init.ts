import { tursoBatch, tursoExecute } from '@/lib/turso/client';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_config (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT, nombre TEXT NOT NULL, rol TEXT NOT NULL CHECK (rol IN ('administrador','cajero')), password_hash TEXT NOT NULL, acceso_bloqueado INTEGER NOT NULL DEFAULT 0, is_seed_admin INTEGER NOT NULL DEFAULT 0, fecha_creacion TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS catalogos (nombre TEXT PRIMARY KEY, lista_json TEXT NOT NULL DEFAULT '[]', data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS productos (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS movimientos (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS ventas (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS cxc (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS cxp (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS clientes (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS proveedores (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS devoluciones (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS anulaciones (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS terminales (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS libro_diario (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reportes_z (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS caja (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS compras (id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', fecha TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS operaciones (id TEXT PRIMARY KEY, prefijo TEXT NOT NULL, operation_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(prefijo, operation_id))`,
  `CREATE INDEX IF NOT EXISTS idx_operaciones_created_at ON operaciones(created_at)`,
  `CREATE TABLE IF NOT EXISTS auditoria_sistema (id TEXT PRIMARY KEY, tipo TEXT, terminal_id TEXT, usuario_id TEXT, fecha TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_terminal_fecha ON auditoria_sistema(terminal_id, fecha)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_fecha ON auditoria_sistema(usuario_id, fecha)`,
  `CREATE TABLE IF NOT EXISTS legacy_documents (path TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}', present INTEGER NOT NULL DEFAULT 1, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT, revoked_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS migration_runs (id TEXT PRIMARY KEY, source TEXT NOT NULL, backup_version INTEGER, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, counts_json TEXT NOT NULL DEFAULT '{}', notes TEXT)`,
];

let initialized = false;
let initializing: Promise<void> | null = null;

async function initialize() {
  // Repetir los CREATE IF NOT EXISTS corrige instalaciones interrumpidas.
  // Son idempotentes y no borran datos existentes.
  await tursoBatch(SCHEMA_STATEMENTS.map(sql => ({ sql, wantRows: false })));

  const requiredTables = [
    'app_config', 'users', 'catalogos', 'productos', 'movimientos', 'ventas',
    'cxc', 'cxp', 'clientes', 'proveedores', 'devoluciones', 'anulaciones',
    'terminales', 'libro_diario', 'reportes_z', 'caja', 'compras',
    'operaciones', 'auditoria_sistema', 'legacy_documents', 'sessions',
    'migration_runs',
  ];
  const verify = await tursoExecute({ sql: "SELECT name FROM sqlite_master WHERE type='table'" });
  const names = new Set(verify.rows.map((row: any) => String(row.name)));
  const missing = requiredTables.filter(required => !names.has(required));
  if (missing.length) {
    throw new Error('Esquema Turso incompleto. Faltan tablas: ' + missing.join(', '));
  }
  if (process.env.POSVEN_DEMO_BUILD === '1') {
    const existing = await tursoExecute({ sql: 'SELECT COUNT(*) AS total FROM productos' });
    if (Number(existing.rows[0]?.total || 0) === 0) {
      const now = new Date().toISOString();
      const products = [
        { id:'DEMO-P-0001', codigo:'750100000001', nombre:'Arroz Premium 1 kg (DEMO)', categoria:'Arroz y Cereales', departamento:'Víveres y Abarrotes', cantidad:'Unidad', marca:'Marca Ficticia', costoUSD:1.10, precioUSD:1.55, margen:29, stock:35, stockMinimo:5, fechaCreacion:now, activo:true, aplicaIVA:false },
        { id:'DEMO-P-0002', codigo:'750100000002', nombre:'Harina de Maíz 1 kg (DEMO)', categoria:'Harinas y Mezclas', departamento:'Víveres y Abarrotes', cantidad:'Unidad', marca:'Marca Ficticia', costoUSD:0.80, precioUSD:1.20, margen:33, stock:28, stockMinimo:5, fechaCreacion:now, activo:true, aplicaIVA:false },
        { id:'DEMO-P-0003', codigo:'750100000003', nombre:'Aceite Vegetal 1 L (DEMO)', categoria:'Aceites y Grasas', departamento:'Víveres y Abarrotes', cantidad:'Unidad', marca:'Marca Ficticia', costoUSD:1.60, precioUSD:2.10, margen:24, stock:18, stockMinimo:4, fechaCreacion:now, activo:true, aplicaIVA:false },
        { id:'DEMO-P-0004', codigo:'750100000004', nombre:'Queso Blanco por kg (DEMO)', categoria:'Quesos', departamento:'Lácteos y Refrigerados', cantidad:'Kilogramo', marca:'Lácteos Ficticios', costoUSD:4.20, precioUSD:5.50, margen:24, stock:12, stockMinimo:2, fechaCreacion:now, activo:true, ventaPorPeso:true, aplicaIVA:false },
        { id:'DEMO-P-0005', codigo:'750100000005', nombre:'Detergente a granel por L (DEMO)', categoria:'Detergentes y Lavado', departamento:'Cuidado del Hogar y Limpieza', cantidad:'Litro', marca:'Limpieza Ficticia', costoUSD:1.30, precioUSD:1.90, margen:31, stock:20, stockMinimo:3, fechaCreacion:now, activo:true, ventaPorVolumen:true, aplicaIVA:false },
        { id:'DEMO-P-0006', codigo:'750100000006', nombre:'Agua Mineral 1.5 L (DEMO)', categoria:'Bebidas No Alcohólicas', departamento:'Bebidas', cantidad:'Unidad', marca:'Agua Ficticia', costoUSD:0.35, precioUSD:0.65, margen:46, stock:42, stockMinimo:8, fechaCreacion:now, activo:true, aplicaIVA:false },
        { id:'DEMO-P-0007', codigo:'750100000007', nombre:'Galletas Dulces (DEMO)', categoria:'Galletas Dulces y Ponqués', departamento:'Panadería y Galletas', cantidad:'Unidad', marca:'Marca Ficticia', costoUSD:0.45, precioUSD:0.75, margen:40, stock:25, stockMinimo:5, fechaCreacion:now, activo:true, aplicaIVA:false },
        { id:'DEMO-P-0008', codigo:'750100000008', nombre:'Tomate por kg (DEMO)', categoria:'Verduras y Hortalizas', departamento:'Frutas y Verduras', cantidad:'Kilogramo', marca:'Huerto Ficticio', costoUSD:1.00, precioUSD:1.60, margen:37, stock:16, stockMinimo:3, fechaCreacion:now, activo:true, ventaPorPeso:true, aplicaIVA:false }
      ];
      const statements: any[] = products.flatMap(product => [
        { sql:'INSERT INTO productos(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)', args:[product.id, JSON.stringify(product)], wantRows:false },
        { sql:'INSERT INTO movimientos(id,data_json,fecha,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', args:['DEMO-MOV-'+product.id, JSON.stringify({id:'DEMO-MOV-'+product.id,productoId:product.id,tipo:'inicial',cantidad:product.stock,stockAntes:0,stockDespues:product.stock,fecha:now,referencia:'Inventario inicial ficticio DEMO'}), now], wantRows:false }
      ]);
      const customers = [
        { id:'DEMO-CLI-001', name:'Cliente Demostración Uno', cedula:'V-00000001', phone:'0000-000001', address:'Dirección ficticia', debt:0 },
        { id:'DEMO-CLI-002', name:'Cliente Demostración Dos', cedula:'V-00000002', phone:'0000-000002', address:'Dirección ficticia', debt:12.5 }
      ];
      for (const customer of customers) statements.push({ sql:'INSERT INTO clientes(id,data_json,fecha,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', args:[customer.id,JSON.stringify(customer),now], wantRows:false });
      const supplier = { id:'DEMO-PROV-001', name:'Distribuidora Ficticia DEMO', rif:'J-00000000-0', phone:'0000-000000', address:'Dirección ficticia', debt:0 };
      statements.push({ sql:'INSERT INTO proveedores(id,data_json,fecha,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', args:[supplier.id,JSON.stringify(supplier),now], wantRows:false });
      const sampleSale = { id:'DEMO-V-00001', fecha:now, cliente:'Cliente Demostración Uno', items:[{productoId:'DEMO-P-0001',nombre:'Arroz Premium 1 kg (DEMO)',cantidad:2,precioUnitUSD:1.55,subtotalUSD:3.10}], subtotalUSD:3.10, descuentoUSD:0, totalUSD:3.10, totalBS:113.15, metodoPago:'Efectivo', estado:'Completada (DEMO)', tasa:36.5, terminalId:'DEMO-CAJA-01' };
      statements.push({ sql:'INSERT INTO ventas(id,data_json,fecha,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', args:[sampleSale.id,JSON.stringify(sampleSale),now], wantRows:false });
      const samplePurchase = { id:'DEMO-C-00001', fecha:now, proveedor:'Distribuidora Ficticia DEMO', numeroFactura:'DEMO-FACT-0001', condicion:'contado', montoUSD:16, pagadoUSD:16, saldoUSD:0, items:[{productoId:'DEMO-P-0001',nombre:'Arroz Premium 1 kg (DEMO)',cantidad:10,costoUnitarioUSD:1.1,subtotalUSD:11}], terminalId:'DEMO-CAJA-01' };
      statements.push({ sql:'INSERT INTO compras(id,data_json,fecha,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', args:[samplePurchase.id,JSON.stringify(samplePurchase),now], wantRows:false });
      statements.push({ sql:'INSERT INTO app_config(id,data_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING', args:['general',JSON.stringify({isInitialized:true,ultimoZ:0,proximoRecibo:2,tasa:36.5,empresa:{nombre:'COMERCIO DE DEMOSTRACIÓN — DATOS FICTICIOS',rif:'J-00000000-0',direccion:'Dirección de ejemplo, no real',telefono:'0000-000000'}})], wantRows:false });
      await tursoBatch(statements);
    }
  }
  initialized = true;
}

export async function ensureTursoSchema() {
  if (initialized) return;
  if (!initializing) {
    initializing = initialize().finally(() => {
      initializing = null;
    });
  }
  await initializing;
}
