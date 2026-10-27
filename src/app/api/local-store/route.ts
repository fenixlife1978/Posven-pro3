import { getRequestSessionId, getSessionUser } from '@/lib/auth/local-auth';
import { NextResponse } from 'next/server';
import { reserveDemoAction, getDemoActionCounts, isDemoExhausted } from '@/lib/demo-limits';
import {
  assertLocalDatabaseReady,
  getRecord,
  listRecords,
  countRecords,
  upsertRecords,
  syncProductChanges,
  syncRecords,
  getAppConfig,
  patchAppConfig,
  getCatalog,
  patchCatalog,
  factoryResetTransaction,
  createSaleTransaction,
  applyInventoryMovementsTransaction,
  syncProductsStockFromKardex,
  patchTerminalTransaction,
  upsertTerminalTransaction,
  deleteTerminalTransaction,
  createZClosureTransaction,
  applyDebtPaymentTransaction,
  createCashMovementTransaction,
  applyGlobalProviderPaymentTransaction,
  applyGlobalCustomerPaymentTransaction,
  createCustomerDebtTransaction,
  createSupplierDebtTransaction,
  processReturnOrCancellationTransaction,
  repairReturnInventoryAndCxcTransaction,
  reverseDebtPaymentTransaction,
  deleteCustomerAndDebtsTransaction,
  deleteCustomerDebtTransaction,
  createPurchaseTransaction,
  deletePurchaseTransaction,
  type LocalStoreTable,
} from '@/lib/local-db/pos-store';

export const runtime = 'nodejs';

const DEMO_MODULE_BY_OPERATION: Record<string, string> = {
  sale: 'Ventas',
  createPurchase: 'Compras',
};

async function resolveDemoModule(operation: string, body: any): Promise<string | undefined> {
  if (operation === 'productSync') {
    const changes = Array.isArray(body?.changes) ? body.changes : [];
    // db-store sends { before, after }; only a new record consumes a creation.
    if (changes.some((change: any) => !change?.before && change?.after?.id)) return 'Productos creados';
    return undefined;
  }
  if (operation === 'upsert' && String(body?.table || '') === 'productos') {
    const records = Array.isArray(body?.records) ? body.records : [];
    for (const record of records) {
      const id = String(record?.id || '').trim();
      if (!id) return 'Productos creados';
      const existing = await getRecord('productos', id);
      if (!existing) return 'Productos creados';
    }
    return undefined;
  }
  return DEMO_MODULE_BY_OPERATION[operation];
}

const TERMINAL_SCOPED_TABLES = new Set([
  'movimientos', 'ventas', 'cxc', 'cxp', 'devoluciones', 'anulaciones',
  'terminales', 'libroDiario', 'reportesZ', 'caja', 'compras',
]);

async function assignedTerminalId(user: { id: string; rol: string }): Promise<string> {
  const terminals = await listRecords('terminales', { limit: 500 });
  const own = terminals.find((item: any) => String(item?.usuarioId || '') === String(user.id));
  if (!own?.id) throw new Error('El cajero no tiene una caja asignada en SQLite local.');
  return String(own.id);
}

function payloadTerminalId(operation: string, body: any): string {
  return String(
    body?.terminalId || body?.terminal?.id || body?.movement?.terminalId ||
    body?.operationDoc?.terminalId || body?.report?.terminalId ||
    body?.sale?.terminalId || body?.params?.terminalId || body?.movements?.[0]?.terminalId || ''
  ).trim();
}

const TERMINAL_BOUND_OPERATIONS = new Set([
  'sale', 'inventory', 'cashMovement', 'terminalPatch', 'terminalUpsert',
  'terminalDelete', 'zClosure', 'returnOrCancellation', 'debtPayment',
]);

const TABLES = new Set([
  'productos','movimientos','ventas','cxc','cxp','clientes','proveedores',
  'devoluciones','anulaciones','terminales','libroDiario','reportesZ','caja','compras',
]);

function table(value: unknown): LocalStoreTable {
  const name = String(value || '');
  if (!TABLES.has(name)) throw new Error('Tabla POSVEN no permitida.');
  return name as LocalStoreTable;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(getRequestSessionId(request));
  if (!user) throw new Error('No autenticado.');
  return user;
}

export async function GET(request: Request) {
  try {
    assertLocalDatabaseReady();
    const user = await requireUser(request);
    const url = new URL(request.url);
    const special = url.searchParams.get('special');
    if (special === 'demoStatus') {
      if (process.env.POSVEN_DEMO_BUILD !== '1') return NextResponse.json({ ok: true, demo: false, counts: {} });
      return NextResponse.json({ ok: true, demo: true, limit: 10, counts: await getDemoActionCounts(), exhausted: (await isDemoExhausted()).exhausted }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (special === 'config') return NextResponse.json({ ok: true, config: await getAppConfig() });
    if (special === 'catalog') return NextResponse.json({ ok: true, lista: await getCatalog(String(url.searchParams.get('name') || '')) });
    const t = table(url.searchParams.get('table'));
    const requestedTerminalId = url.searchParams.get('terminalId') || undefined;
    const cashierTerminalId = user.rol === 'cajero' ? await assignedTerminalId(user) : undefined;
    if (user.rol === 'cajero' && requestedTerminalId && requestedTerminalId !== cashierTerminalId) {
      return NextResponse.json({ ok: false, error: 'No puede consultar información de otra caja.' }, { status: 403 });
    }
    // Las CxC son obligaciones del cliente, no propiedad de una caja. El POS
    // necesita consultar y cobrar el saldo consolidado aunque la venta se haya
    // originado en otra terminal; se conserva la restricción de terminal para
    // operaciones de caja, ventas y demás tablas operativas.
    const scopedTerminalId = cashierTerminalId && TERMINAL_SCOPED_TABLES.has(String(t)) && t !== 'terminales' && t !== 'cxc'
      ? cashierTerminalId
      : requestedTerminalId;
    if (special === 'count') {
      let total: number;
      if (cashierTerminalId && t === 'terminales') {
        total = 1;
      } else if (cashierTerminalId && TERMINAL_SCOPED_TABLES.has(String(t))) {
        total = (await listRecords(t, { limit: 10000, terminalId: cashierTerminalId })).length;
      } else {
        total = await countRecords(t);
      }
      return NextResponse.json({ ok: true, total });
    }
    const id = url.searchParams.get('id');
    if (id) {
      const record = await getRecord(t, id);
      if (user.rol === 'cajero' && record) {
        const recordTerminalId = t === 'terminales' ? String(record.id) : String(record.terminalId || '');
        if (TERMINAL_SCOPED_TABLES.has(String(t)) && recordTerminalId !== cashierTerminalId) {
          return NextResponse.json({ ok: false, error: 'No puede consultar registros de otra caja.' }, { status: 403 });
        }
      }
      return NextResponse.json({ ok: true, record });
    }
    let records = await listRecords(t, {
      limit: Number(url.searchParams.get('limit') || 500),
      offset: Number(url.searchParams.get('offset') || 0),
      terminalId: user.rol === 'cajero' && t === 'terminales' ? undefined : scopedTerminalId,
      estado: url.searchParams.get('estado') || undefined,
    });
    if (user.rol === 'cajero' && t === 'terminales') records = records.filter((item: any) => String(item.id) === cashierTerminalId);
    return NextResponse.json({ ok: true, records });
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = message.includes('no está configurado') ? 503
      : message.includes('No autenticado') ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalDatabaseReady();
    const user = await requireUser(request);
    const body = await request.json();
    const operation = String(body?.operation || '');
    if (user.rol === 'cajero') {
      const ownTerminalId = await assignedTerminalId(user);
      const targetTerminalId = payloadTerminalId(operation, body);
      if (TERMINAL_BOUND_OPERATIONS.has(operation) &&
          (!targetTerminalId || targetTerminalId !== ownTerminalId)) {
        return NextResponse.json({ ok: false, error: 'La operación debe pertenecer exclusivamente a la caja asignada a este cajero.' }, { status: 403 });
      }
    }
    if (process.env.POSVEN_DEMO_BUILD === '1') {
      const status = await isDemoExhausted();
      if (status.exhausted) {
        return NextResponse.json({
          ok: false,
          error: `La versión DEMO alcanzó el límite de 10/10 en «${status.module}». La prueba del sistema ha terminado. Adquiere la versión COMPLETA para seguir trabajando sin interrupciones.`,
          demoLimitReached: true,
          module: status.module,
          counts: status.counts,
          limit: 10,
        }, { status: 429 });
      }
      const moduleName = await resolveDemoModule(operation, body);
      if (moduleName && !(await reserveDemoAction(moduleName))) {
        const latest = await isDemoExhausted();
        const exhaustedModule = latest.module || moduleName;
        return NextResponse.json({
          ok: false,
          error: `La versión DEMO alcanzó el límite de 10/10 en «${exhaustedModule}». La prueba del sistema ha terminado. Adquiere la versión COMPLETA para seguir trabajando sin interrupciones.`,
          demoLimitReached: true,
          module: exhaustedModule,
          counts: latest.counts,
          limit: 10,
        }, { status: 429 });
      }
    }

    switch (operation) {
      case 'configPatch': {
        // La tasa BCV es una configuración operativa que los cajeros están
        // autorizados a actualizar permanentemente. Los demás parámetros de
        // configuración siguen restringidos al administrador.
        const patch = body.patch || {};
        const keys = Object.keys(patch);
        const onlyRate = keys.length > 0 && keys.every((key) => key === 'tasa');
        if (user.rol !== 'administrador' && !onlyRate) {
          throw new Error('Solo la tasa BCV puede ser modificada por un cajero.');
        }
        const config = await patchAppConfig(patch);
        return NextResponse.json({ ok: true, config });
      }
      case 'catalogPatch': {
        if (user.rol !== 'administrador') throw new Error('Se requiere administrador.');
        const lista = await patchCatalog(String(body.name), Array.isArray(body.lista) ? body.lista : []);
        return NextResponse.json({ ok: true, name: String(body.name), lista });
      }
      case 'factoryReset': {
        const result = await factoryResetTransaction({ user });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'productSync': {
        if (user.rol !== 'administrador') throw new Error('Se requiere administrador.');
        const result = await syncProductChanges({
          changes: Array.isArray(body.changes) ? body.changes : [],
          deletedIds: Array.isArray(body.deletedIds) ? body.deletedIds : [],
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'recordsSync': {
        const allowed = new Set(['clientes', 'proveedores', 'movimientos', 'libroDiario']);
        const target = String(body.table || '');
        if (!allowed.has(target)) throw new Error('Tabla no permitida para sincronización general.');
        if (target === 'proveedores' && user.rol !== 'administrador') throw new Error('Se requiere administrador.');
        const result = await syncRecords({
          table: target as any,
          records: Array.isArray(body.records) ? body.records : [],
          deletedIds: Array.isArray(body.deletedIds) ? body.deletedIds : [],
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'upsert': {
        if (user.rol !== 'administrador') throw new Error('Se requiere administrador.');
        const result = await upsertRecords(table(body.table), Array.isArray(body.records) ? body.records : []);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'inventoryStockSync': {
        const result = await syncProductsStockFromKardex();
        return NextResponse.json({ ok: true, ...result });
      }
      case 'inventory': {
        const result = await applyInventoryMovementsTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'sale': {
        const result = await createSaleTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'terminalPatch': {
        const result = await patchTerminalTransaction({ user, terminalId: String(body.terminalId), patch: body.patch || {} });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'terminalUpsert': {
        const result = await upsertTerminalTransaction({ user, terminal: body.terminal });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'terminalDelete': {
        const result = await deleteTerminalTransaction({ user, terminalId: String(body.terminalId) });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'debtPayment': {
        const result = await applyDebtPaymentTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'cashMovement': {
        const result = await createCashMovementTransaction({
          operationId: String(body.operationId || ''),
          movement: body.movement,
          terminalId: String(body.terminalId || body.movement?.terminalId || ''),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'globalProviderPayment': {
        const result = await applyGlobalProviderPaymentTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'globalCustomerPayment': {
        const result = await applyGlobalCustomerPaymentTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'customerDebt': {
        const result = await createCustomerDebtTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'supplierDebt': {
        const result = await createSupplierDebtTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'reverseDebtPayment': {
        const result=await reverseDebtPaymentTransaction(body); return NextResponse.json({ok:true,...result});
      }
      case 'createPurchase': { const result=await createPurchaseTransaction(body); return NextResponse.json({ok:true,...result}); }
      case 'deletePurchase': { const result=await deletePurchaseTransaction(body); return NextResponse.json({ok:true,...result}); }
      case 'deleteCustomerDebt': { const result=await deleteCustomerDebtTransaction(body); return NextResponse.json({ok:true,...result}); }
      case 'deleteCustomerAndDebts': {
        const result=await deleteCustomerAndDebtsTransaction(body); return NextResponse.json({ok:true,...result});
      }
      case 'returnOrCancellation': {
        const result = await processReturnOrCancellationTransaction(body);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'repairReturnInventoryAndCxc': {
        if (user.rol !== 'administrador') throw new Error('Se requiere administrador.');
        const result = await repairReturnInventoryAndCxcTransaction({
          saleId: String(body.saleId || ''),
          operationId: String(body.operationId || ('REPAIR-' + String(body.saleId || '') + '-' + Date.now())),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'zClosure': {
        const result = await createZClosureTransaction({
          user,
          terminalId: String(body.terminalId),
          report: body.report,
          terminalPatch: body.terminalPatch || {},
        });
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        throw new Error('Operación local no soportada todavía.');
    }
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = message.includes('no está configurado') ? 503
      : message.includes('No autenticado') ? 401
      : message.includes('Se requiere administrador') ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
