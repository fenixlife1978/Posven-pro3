'use client';

import React, { useEffect, useState } from 'react';
import { X, Receipt } from 'lucide-react';
import { Utils, Store } from '@/lib/db-store';

interface CreditDetailModalProps {
  debt: any;
  onClose: () => void;
}

const normalizeSaleItem = (item: any) => {
  const cantidad = Number(item?.cantidad ?? item?.qty ?? item?.quantity ?? 0);
  const precioUnitUSD = Number(item?.precioUnitUSD ?? item?.precioUSD ?? item?.precio ?? item?.priceUSD ?? item?.price ?? 0);
  const subtotalUSD = Number(item?.subtotalUSD ?? item?.totalUSD ?? item?.subtotal ?? item?.total ?? (cantidad * precioUnitUSD));
  return {
    ...item,
    productoId: String(item?.productoId ?? item?.productId ?? item?.id ?? ''),
    nombre: String(item?.nombre ?? item?.productoNombre ?? item?.producto ?? item?.descripcion ?? item?.description ?? item?.name ?? 'Ítem'),
    cantidad,
    precioUnitUSD,
    subtotalUSD,
  };
};

const normalizeSale = (sale: any) => {
  if (!sale || !Array.isArray(sale.items)) return sale;
  return { ...sale, items: sale.items.map(normalizeSaleItem) };
};

const sameItems = (a: any[], b: any[]) => {
  if (!a.length || !b.length || a.length !== b.length) return false;
  return a.every((x: any, i: number) => {
    const y = b[i] || {};
    return String(x?.productoId || '') === String(y?.productoId || '') &&
      Number(x?.cantidad || 0) === Number(y?.cantidad || 0) &&
      Math.abs((Number(x?.subtotalUSD) || 0) - (Number(y?.subtotalUSD) || 0)) < 0.001;
  });
};

async function loadOriginalSale(debt: any) {
  // CxC Administración resuelve primero el registro autoritativo de la deuda
  // y luego intenta la venta por ventaId/facturaId. Para históricos migrados,
  // el id de la propia deuda puede ser también la referencia de la venta.
  let authoritativeCxc: any = null;
  try {
    const debtId = String(debt?.id || '').trim();
    if (debtId) {
      const response = await fetch('/api/turso/store?table=cxc&id=' + encodeURIComponent(debtId), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.record) authoritativeCxc = body.record;
      }
    }
  } catch (e) {
    console.warn('No se pudo leer la deuda CxC para el detalle:', e);
  }

  const sourceDebt = authoritativeCxc || debt;
  const ventaId = String(sourceDebt?.ventaId || sourceDebt?.facturaId || '').trim();
  const saleIds = [...new Set([
    ventaId,
    String(sourceDebt?.id || debt?.id || '').trim(),
  ].filter(Boolean))];

  let sale: any = null;
  for (const id of saleIds) {
    sale = await Store.getSaleById(id);
    if (sale) break;
  }

  const debtItems = Array.isArray(sourceDebt?.items) ? sourceDebt.items : [];

  if (debtItems.length && (!sale || !sameItems(debtItems, Array.isArray(sale.items) ? sale.items : []))) {
    sale = {
      id: ventaId || String(sourceDebt?.id || debt?.id || ''),
      fecha: String(sourceDebt?.fecha || debt?.fecha || ''),
      cliente: sourceDebt?.cliente || debt?.cliente || '',
      items: debtItems.map((x: any) => ({ ...x })),
      subtotalUSD: Number(sourceDebt?.subtotalUSD ?? sourceDebt?.totalUSD ?? sourceDebt?.montoUSD ?? debt?.montoUSD ?? 0),
      totalUSD: Number(sourceDebt?.totalUSD ?? sourceDebt?.montoUSD ?? debt?.montoUSD ?? 0),
      totalBS: Number(sourceDebt?.totalBS ?? debt?.totalBS ?? 0),
      tasa: Number(sourceDebt?.tasa ?? debt?.tasa ?? 0),
    };
  }

  if (!sale) {
    const cxcMatch = (Store.get().cxc || []).find((x: any) =>
      String(x?.id || '') === String(debt?.id || '') ||
      (ventaId && String(x?.ventaId || x?.facturaId || '') === ventaId)
    );
    const cxcItems = Array.isArray(cxcMatch?.items) ? cxcMatch.items : [];
    if (cxcItems.length) {
      sale = {
        id: ventaId || String(debt?.id || ''),
        fecha: String(cxcMatch?.fecha || debt?.fecha || ''),
        cliente: cxcMatch?.cliente || debt?.cliente || '',
        items: cxcItems.map((x: any) => ({ ...x })),
        subtotalUSD: Number(cxcMatch?.subtotalUSD ?? cxcMatch?.totalUSD ?? cxcMatch?.montoUSD ?? debt?.montoUSD ?? 0),
        totalUSD: Number(cxcMatch?.totalUSD ?? cxcMatch?.montoUSD ?? debt?.montoUSD ?? 0),
        totalBS: Number(cxcMatch?.totalBS ?? debt?.totalBS ?? 0),
        tasa: Number(cxcMatch?.tasa ?? debt?.tasa ?? 0),
      };
    }
  }

  return normalizeSale(sale);
}

export default function CreditDetailModal({ debt, onClose }: CreditDetailModalProps) {
  const [sale, setSale] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setSale(null);
    if (!debt) return;
    void loadOriginalSale(debt).then(result => {
      if (!cancelled) setSale(result);
    }).catch(error => {
      console.error('Error cargando detalle de compra original:', error);
      if (!cancelled) setSale(null);
    });
    return () => { cancelled = true; };
  }, [debt]);

  if (!debt) return null;

  return (
    <div className="modal show" style={{ zIndex: 100 }}>
      <div className="modal-bg" onClick={onClose}></div>
      <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
        <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
          <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <Receipt className="w-5 h-5 text-brand-gold" /> HISTORIAL DETALLADO: {debt.id}
          </h3>
          <button onClick={onClose} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
        </div>
        <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-surface-soft rounded-lg border border-line">
              <label className="text-[8px] font-black uppercase text-ink block mb-1">Monto Original</label>
              <p className="text-lg font-black text-ink">{Utils.fmtUSD(debt.montoUSD)}</p>
            </div>
            <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
              <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Saldo Actual</label>
              <p className="text-lg font-black text-brand-gold-deep">{Utils.fmtUSD(debt.saldoUSD)}</p>
            </div>
          </div>

          {sale && Array.isArray(sale.items) && sale.items.length > 0 && (
            <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
              <div className="flex justify-between items-center border-b border-line pb-2">
                <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE COMPRA ORIGINAL</h4>
                <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(sale.fecha)} - {sale.fecha.split('T')[1]?.slice(0,5)}</span>
              </div>
              <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                <table className="w-full">
                  <thead>
                    <tr className="bg-ink/5">
                      <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Cant</th>
                      <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Descripción</th>
                      <th className="text-[8px] font-black uppercase p-2 text-right text-ink">P. Unit</th>
                      <th className="text-[8px] font-black uppercase p-2 text-right text-ink">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sale.items.map((it: any, idx: number) => (
                      <tr key={idx} className="border-b border-line/20">
                        <td className="text-[9px] font-black p-2 text-ink">{it.cantidad}</td>
                        <td className="text-[9px] font-black uppercase p-2 text-ink truncate max-w-[180px]">{it.nombre}</td>
                        <td className="text-[9px] font-black p-2 text-right text-ink">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                        <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS</h4>
            <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
              {(!debt.historialPagos || debt.historialPagos.length === 0) ? (
                <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han registrado abonos aún</div>
              ) : (
                debt.historialPagos.map((p: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)} - {p.fecha.split('T')[1]?.slice(0,5)}</p>
                      <p className="text-[8px] font-black text-ink mono">REF RECIBO: {p.reciboId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-status-success">+{Utils.fmtUSD(p.montoUSD)}</p>
                      <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
          <button onClick={onClose} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Ficha</button>
        </div>
      </div>
    </div>
  );
}
