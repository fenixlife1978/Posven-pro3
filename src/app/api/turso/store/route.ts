import { getRequestSessionId, getSessionUser } from '@/lib/auth/turso-auth';
import { NextResponse } from 'next/server';
import {
  assertTursoReady,
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
  type TursoStoreTable,
} from '@/lib/turso/pos-store';

export const runtime = 'nodejs';

const TABLES = new Set([
  'productos','movimientos','ventas','cxc','cxp','clientes','proveedores',
  'devoluciones','anulaciones','terminales','libroDiario','reportesZ','caja','compras',
]);

function table(value: unknown): TursoStoreTable {
  const name = String(value || '');
  if (!TABLES.has(name)) throw new Error('Tabla POSVEN no permitida.');
  return name as TursoStoreTable;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(getRequestSessionId(request));
  if (!user) throw new Error('No autenticado.');
  return user;
}

export async function GET(request: Request) {
  try {
    assertTursoReady();
    await requireUser(request);
    const url = new URL(request.url);
    const special = url.searchParams.get('special');
    if (special === 'config') return NextResponse.json({ ok: true, config: await getAppConfig() });
    if (special === 'catalog') return NextResponse.json({ ok: true, lista: await getCatalog(String(url.searchParams.get('name') || '')) });
    const t = table(url.searchParams.get('table'));
    if (special === 'count') return NextResponse.json({ ok: true, total: await countRecords(t) });
    const id = url.searchParams.get('id');
    if (id) return NextResponse.json({ ok: true, record: await getRecord(t, id) });
    const records = await listRecords(t, {
      limit: Number(url.searchParams.get('limit') || 500),
      offset: Number(url.searchParams.get('offset') || 0),
      terminalId: url.searchParams.get('terminalId') || undefined,
      estado: url.searchParams.get('estado') || undefined,
    });
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
    assertTursoReady();
    const user = await requireUser(request);
    const body = await request.json();

    switch (String(body?.operation || '')) {
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
        throw new Error('Operación Turso no soportada todavía.');
    }
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = message.includes('no está configurado') ? 503
      : message.includes('No autenticado') ? 401
      : message.includes('Se requiere administrador') ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
