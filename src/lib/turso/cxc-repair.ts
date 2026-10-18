import { tursoExecute } from '@/lib/turso/client';

function safeJson(value: any) {
  return JSON.stringify(value ?? {});
}

export async function repararDeudasMigradas() {
  const debts = await tursoExecute({ sql: 'SELECT id,data_json FROM cxc' });
  const result = {
    revisadas: debts.rows.length,
    corregidas: 0,
    sinVenta: 0,
    sinItemsVenta: 0,
    sinCambios: 0,
    detalles: [] as Array<{id:string;ventaId:string;estado:string}>,
  };

  for (const row of debts.rows) {
    const id = String(row.id ?? '').trim();
    let debt: any = null;
    try { debt = JSON.parse(String(row.data_json || '{}')); } catch {}
    if (!debt || typeof debt !== 'object') {
      result.detalles.push({ id, ventaId: '', estado: 'datos_deuda_invalidos' });
      continue;
    }

    const ventaId = String(debt.ventaId || debt.facturaId || '').trim();
    if (!ventaId) {
      result.sinVenta++;
      result.detalles.push({ id, ventaId: '', estado: 'sin_ventaId' });
      continue;
    }

    const saleResult = await tursoExecute({
      sql: 'SELECT data_json FROM ventas WHERE id=? LIMIT 1',
      args: [ventaId],
    });
    if (!saleResult.rows.length) {
      result.sinVenta++;
      result.detalles.push({ id, ventaId, estado: 'venta_no_encontrada' });
      continue;
    }

    let sale: any = null;
    try { sale = JSON.parse(String(saleResult.rows[0].data_json || '{}')); } catch {}
    if (!sale || !Array.isArray(sale.items)) {
      result.sinItemsVenta++;
      result.detalles.push({ id, ventaId, estado: 'venta_sin_items' });
      continue;
    }

    const nextDebt = {
      ...debt,
      ventaId,
      facturaId: String(debt.facturaId || sale.facturaId || ventaId),
      items: sale.items.map((item: any) => ({ ...item })),
      subtotalUSD: Number(sale.subtotalUSD ?? sale.subtotal ?? debt.subtotalUSD ?? 0),
      totalUSD: Number(sale.totalUSD ?? debt.totalUSD ?? debt.montoUSD ?? 0),
      totalBS: Number(sale.totalBS ?? debt.totalBS ?? 0),
      tasa: Number(sale.tasa ?? debt.tasa ?? 0),
    };

    const before = safeJson(debt);
    const after = safeJson(nextDebt);
    if (before === after) {
      result.sinCambios++;
      result.detalles.push({ id, ventaId, estado: 'ya_consistente' });
      continue;
    }

    await tursoExecute({
      sql: 'UPDATE cxc SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      args: [after, id],
      wantRows: false,
    });
    result.corregidas++;
    result.detalles.push({ id, ventaId, estado: 'corregida' });
  }

  return result;
}
