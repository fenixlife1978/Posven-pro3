"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Return, Sale, ReturnItem, Movimiento, Anulacion, LibroDiarioEntry } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { DateRangeFilter, DateRange } from '@/components/ui/date-range-filter';
import { 
  RotateCcw, 
  Search, 
  X, 
  Trash2, 
  AlertTriangle, 
  Undo2,
  ClipboardList,
  History,
  AlertCircle,
  ShieldX,
  ArrowLeft,
  Eye,
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function ReturnsModule({ state, updateState, onBackToPOS, terminalId }: { state: AppState, updateState: (s: Partial<AppState>) => void, onBackToPOS: () => void, terminalId?: string }) {
  useEffect(() => { Store.ensureLoaded('ventas'); }, []);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [saleSearch, setSaleSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [refundMethod, setRefundMethod] = useState<'EFECTIVO' | 'MISMO_METODO' | 'CREDITO_TIENDA'>('EFECTIVO');
  const [reason, setMotivo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });

  const buscarVenta = () => {
    const sale = state.ventas.find(v => (v.id === saleSearch || v.id.endsWith(saleSearch)) && (!terminalId || v.terminalId === terminalId));
    if (!sale) return alert('Venta no encontrada en este terminal.');
    if (sale.estado === 'anulada') return alert('Esta factura ya ha sido anulada previamente.');
    
    setSelectedSale(sale);
    setReturnItems([]);
  };

  const handleAddItem = (productoId: string, nombre: string, precioUnitUSD: number, maxQty: number) => {
    const alreadyReturned = (state.devoluciones || [])
      .filter(d => d.ventaId === selectedSale?.id)
      .flatMap(d => d.items)
      .filter(i => i.productoId === productoId)
      .reduce((sum, i) => sum + i.cantidad, 0);

    const availableToReturn = maxQty - alreadyReturned;

    if (availableToReturn <= 0) {
      return alert('Este producto ya ha sido devuelto en su totalidad.');
    }

    const qtyStr = prompt(`Cantidad a devolver (Máx: ${availableToReturn}):`, '1');
    if (!qtyStr) return;
    const qty = parseInt(qtyStr || '0');
    if (isNaN(qty) || qty <= 0 || qty > availableToReturn) return alert('Cantidad no válida');

    const condition = confirm('¿El producto se encuentra APTO para la venta? (OK: Vuelve a stock, CANCEL: Va a merma/daño)') 
      ? 'REINTEGRADO_STOCK' 
      : 'MERMA_DANADO';

    setReturnItems([...returnItems, {
      productoId,
      nombre,
      cantidad: qty,
      precioUnitUSD,
      estadoProducto: condition as any
    }]);
  };

  const procesarDevolucion = async () => {
    if (!selectedSale || returnItems.length === 0 || isProcessing) return;
    if (!reason.trim()) return alert('Por favor indique el motivo de la devolución');

    setIsProcessing(true);
    try {
      const totalDevuelto = returnItems.reduce((s, i) => s + (i.cantidad * i.precioUnitUSD), 0);
      const idDev = 'DEV-' + String(state.proximaDevolucion || 1).padStart(6, '0');
      const ahoraStr = Utils.ahora();

      const nuevaDevolucion: Return = {
        id: idDev,
        ventaId: selectedSale.id,
        fecha: ahoraStr,
        items: [...returnItems],
        totalUSD: totalDevuelto,
        metodoReembolso: refundMethod,
        motivo: reason
      };

      const nuevosProductos = [...state.productos];
      const nuevosMovimientos: Movimiento[] = [];

      returnItems.forEach(item => {
        const pIdx = nuevosProductos.findIndex(p => p.id === item.productoId);
        if (pIdx >= 0) {
          const p = nuevosProductos[pIdx];
          const stockAntes = p.stock;
          
          if (item.estadoProducto === 'REINTEGRADO_STOCK') {
            nuevosProductos[pIdx] = { ...p, stock: p.stock + item.cantidad };
          }

          nuevosMovimientos.push({
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'devolucion',
            cantidad: item.cantidad,
            stockAntes,
            stockDespues: nuevosProductos[pIdx].stock,
            fecha: ahoraStr,
            referencia: `DEVOLUCIÓN ${idDev} - REF VENTA ${selectedSale.id}`,
            terminalId: terminalId || 'GLOBAL'
          });
        }
      });

      const nuevasVentas = state.ventas.map(v => {
        if (v.id === selectedSale.id) {
          return { ...v, estado: 'parcialmente_devuelta' as any };
        }
        return v;
      });

      const nuevoAsiento: LibroDiarioEntry = {
        id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
        fecha: ahoraStr,
        tipo: 'egreso',
        categoria: 'DEVOLUCION',
        concepto: `DEVOLUCIÓN DINERO ${idDev} - REF VENTA ${selectedSale.id}`,
        montoUSD: totalDevuelto,
        montoBS: totalDevuelto * state.tasa,
        metodo: refundMethod === 'EFECTIVO' ? 'efectivo_usd' : (refundMethod === 'MISMO_METODO' ? 'otros' : 'nota_credito'),
        referencia: idDev
      };

      updateState({
        productos: nuevosProductos,
        devoluciones: [nuevaDevolucion, ...(state.devoluciones || [])],
        movimientos: [...state.movimientos, ...nuevosMovimientos],
        ventas: nuevasVentas,
        proximaDevolucion: (state.proximaDevolucion || 1) + 1,
        libroDiario: [nuevoAsiento, ...(state.libroDiario || [])]
      });

      alert(`Devolución ${idDev} procesada con éxito`);
      setView('list');
      setSelectedSale(null);
      setReturnItems([]);
      setMotivo('');
    } finally {
      setIsProcessing(false);
    }
  };

  const anularFacturaCompleta = async () => {
    if (!selectedSale || isProcessing) return;
    const pin = prompt('AUTORIZACIÓN REQUERIDA: Ingrese PIN de Seguridad:');
    if (pin !== state.pinDevolucion) return alert('PIN Incorrecto');

    if (!confirm(`¿ESTÁ SEGURO DE ANULAR LA FACTURA ${selectedSale.id}?\nEsta acción devolverá todo el stock al inventario.`)) return;

    const representaEgreso = confirm("¿Esta anulación requiere el REINTEGRO DE DINERO físico al cliente?\n(Si confirma, se generará un asiento de EGRESO en contabilidad)");

    setIsProcessing(true);
    try {
      const ahoraStr = Utils.ahora();
      const nuevosProductos = [...state.productos];
      const nuevosMovimientos: Movimiento[] = [];

      selectedSale.items.forEach(item => {
        const pIdx = nuevosProductos.findIndex(p => p.id === item.productoId);
        if (pIdx >= 0) {
          const p = nuevosProductos[pIdx];
          const stockAntes = p.stock;
          nuevosProductos[pIdx] = { ...p, stock: p.stock + item.cantidad };
          
          nuevosMovimientos.push({
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'anulacion',
            cantidad: item.cantidad,
            stockAntes,
            stockDespues: nuevosProductos[pIdx].stock,
            fecha: ahoraStr,
            referencia: `ANULACIÓN TOTAL FACTURA #${selectedSale.id}`,
            terminalId: terminalId || 'GLOBAL'
          });
        }
      });

      const nuevasVentas = state.ventas.map(v => 
        v.id === selectedSale.id ? { ...v, estado: 'anulada' } : v
      );

      const idAnu = 'ANU-' + String(state.proximaAnulacion || 1).padStart(5, '0');
      const nuevaAnulacion: Anulacion = {
        id: idAnu,
        ventaId: selectedSale.id,
        fecha: ahoraStr,
        totalUSD: selectedSale.totalUSD,
        motivo: 'ANULACIÓN TOTAL DE FACTURA POR OPERADOR',
        items: [...selectedSale.items]
      };

      let nuevosAsientosDiario: LibroDiarioEntry[] = [];
      if (representaEgreso) {
        nuevosAsientosDiario.push({
          id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
          fecha: ahoraStr,
          tipo: 'egreso',
          categoria: 'ANULACION',
          concepto: `REINTEGRO POR ANULACIÓN FACTURA #${selectedSale.id}`,
          montoUSD: selectedSale.totalUSD,
          montoBS: selectedSale.totalBS,
          metodo: selectedSale.metodoPago || 'otros',
          referencia: idAnu
        });
      }

      updateState({
        productos: nuevosProductos,
        ventas: nuevasVentas,
        movimientos: [...state.movimientos, ...nuevosMovimientos],
        anulaciones: [nuevaAnulacion, ...(state.anulaciones || [])],
        libroDiario: representaEgreso ? [...nuevosAsientosDiario, ...(state.libroDiario || [])] : state.libroDiario,
        proximaAnulacion: (state.proximaAnulacion || 1) + 1
      });

      toast({ title: "Factura Anulada", description: `El documento ${selectedSale.id} ha sido invalidado bajo el registro ${idAnu}.` });
      setView('list');
      setSelectedSale(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const historialUnificado = useMemo(() => {
    const enRango = (f: string) => f && f.slice(0, 10) >= rango.desde && f.slice(0, 10) <= rango.hasta;
    const devs = (state.devoluciones || [])
      .filter(d => (!terminalId || state.ventas.find(v => v.id === d.ventaId)?.terminalId === terminalId) && enRango(d.fecha))
      .map(d => ({ ...d, tipoOperacion: 'DEVOLUCIÓN' }));
    
    const anus = (state.anulaciones || [])
      .filter(a => (!terminalId || state.ventas.find(v => v.id === a.ventaId)?.terminalId === terminalId) && enRango(a.fecha))
      .map(a => ({ ...a, tipoOperacion: 'ANULACIÓN', items: a.items || [] }));
    
    return [...devs, ...anus].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [state.devoluciones, state.anulaciones, state.ventas, terminalId, rango]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-line shadow-sm">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-xl flex items-center gap-2">
            <RotateCcw className="text-status-danger" /> DEVOLUCIONES Y ANULACIONES
          </h2>
        </div>
        <div className="flex gap-2">
          <button onClick={onBackToPOS} className="btn btn-secondary h-9 px-4 font-black uppercase text-[10px] flex items-center gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver al POS
          </button>
          <button 
            onClick={() => { setView(view === 'list' ? 'create' : 'list'); setSelectedSale(null); }} 
            className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'} h-10 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-sm`}
          >
            {view === 'list' ? <><RotateCcw className="w-4 h-4" /> Nueva Operación</> : <><History className="w-4 h-4" /> Ver Historial</>}
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="card shadow-lg animate-in fade-in duration-300 border-line bg-white">
          <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
            <h3 className="text-ink font-black text-xs uppercase tracking-widest flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-status-info" /> Historial de {terminalId ? `Terminal ${terminalId}` : 'Sistema'}
            </h3>
          </div>
          <div className="px-5 py-3 border-b border-line no-print">
            <label className="text-[10px] font-black uppercase text-ink/40 block mb-2">CONSULTAR POR PERÍODO</label>
            <DateRangeFilter value={rango} onChange={setRango} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr className="bg-surface-soft">
                  <th className="text-ink font-black text-[10px] uppercase">ID Operación</th>
                  <th className="text-ink font-black text-[10px] uppercase">Tipo</th>
                  <th className="text-ink font-black text-[10px] uppercase">Fecha</th>
                  <th className="text-ink font-black text-[10px] uppercase">Venta Ref.</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Monto Total</th>
                  <th className="text-ink font-black text-[10px] uppercase">Motivo</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {historialUnificado.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-20 text-ink/20 font-black uppercase italic opacity-40">No hay operaciones registradas para este terminal</td></tr>
                ) : (
                  historialUnificado.map(d => (
                    <tr key={d.id} className="border-b border-line/30 hover:bg-surface-warm/20">
                      <td className={`font-black text-xs mono ${d.id.startsWith('ANU') ? 'text-ink' : 'text-status-danger'}`}>{d.id}</td>
                      <td className="text-[9px] font-black uppercase">
                        <span className={`badge ${d.tipoOperacion === 'ANULACIÓN' ? 'badge-neutral' : 'badge-err'}`}>{d.tipoOperacion}</span>
                      </td>
                      <td className="text-ink font-bold text-xs">{Utils.fmtFecha(d.fecha)}</td>
                      <td className="text-ink font-black text-xs mono opacity-60">{d.ventaId}</td>
                      <td className="text-brand-gold-deep font-black text-xs text-right">{Utils.fmtUSD(d.totalUSD)}</td>
                      <td className="text-ink text-[10px] uppercase font-bold italic truncate max-w-[200px]">{d.motivo}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-300">
          <div className="lg:col-span-2 space-y-4">
            {!selectedSale ? (
              <div className="card p-12 flex flex-col items-center justify-center text-center space-y-6 bg-white border-dashed border-2 border-line">
                <div className="p-5 bg-surface-soft rounded-full"><Search className="w-10 h-10 text-ink/20" /></div>
                <div className="max-w-xs space-y-2">
                  <h3 className="text-ink font-black uppercase text-sm">Localizar Factura</h3>
                  <p className="text-[10px] text-ink font-bold uppercase opacity-60">Solo se permiten reversiones de ventas generadas en este terminal por seguridad.</p>
                </div>
                <div className="flex gap-2 w-full max-w-sm">
                  <input 
                    className="form-input flex-1 h-12 bg-white border-line text-ink font-black uppercase" 
                    placeholder="Ej: 000000024"
                    value={saleSearch}
                    onChange={e => setSaleSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarVenta()}
                  />
                  <button onClick={buscarVenta} className="btn btn-primary h-12 px-6 font-black uppercase text-xs shadow-md">Buscar</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="card bg-white border-status-info/30">
                  <div className="card-head py-3 px-5 border-b border-line flex justify-between items-center">
                    <h3 className="text-status-info font-black uppercase text-xs">Venta Original: {selectedSale.id}</h3>
                    <div className="flex gap-2">
                       <button onClick={anularFacturaCompleta} disabled={isProcessing} className="btn btn-danger h-8 px-4 font-black uppercase text-[9px] flex items-center gap-2">
                         {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldX className="w-3.5 h-3.5" />} ANULACIÓN TOTAL
                       </button>
                       <button onClick={() => setSelectedSale(null)} className="text-ink/40 hover:text-ink"><X className="w-4 h-4"/></button>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr className="bg-surface-soft">
                          <th className="text-[9px] uppercase font-black text-ink">Producto</th>
                          <th className="text-[9px] uppercase text-center font-black text-ink">Cant. Compra</th>
                          <th className="text-[9px] uppercase text-right font-black text-ink">Precio Hist.</th>
                          <th className="text-[9px] uppercase text-center font-black text-ink">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSale.items.map((item, idx) => (
                          <tr key={idx} className="border-b border-line/30">
                            <td className="text-ink font-bold text-xs uppercase">{item.nombre}</td>
                            <td className="text-ink font-black text-xs text-center">{item.cantidad}</td>
                            <td className="text-ink font-black text-xs text-right">{Utils.fmtUSD(item.precioUnitUSD)}</td>
                            <td className="text-center">
                              <button 
                                onClick={() => handleAddItem(item.productoId, item.nombre, item.precioUnitUSD, item.cantidad)}
                                className="btn btn-sm btn-secondary text-ink font-black text-[9px] uppercase h-7"
                              >
                                Devolver Item
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card bg-white border-line shadow-sm">
                  <div className="card-head py-3 px-5 border-b border-line">
                    <h3 className="text-status-danger font-black uppercase text-xs flex items-center gap-2">
                      <Undo2 className="w-4 h-4"/> Ítems en la Devolución Actual
                    </h3>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr className="bg-surface-soft">
                          <th className="text-[9px] uppercase font-black text-ink">Producto</th>
                          <th className="text-[9px] uppercase text-center font-black text-ink">Cant.</th>
                          <th className="text-[9px] uppercase font-black text-ink">Estado / Destino</th>
                          <th className="text-[9px] uppercase text-right font-black text-ink">Subtotal</th>
                          <th className="text-[9px] uppercase text-center"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnItems.map((item, idx) => (
                          <tr key={idx} className="border-b border-line/30">
                            <td className="text-ink font-bold text-xs uppercase">{item.nombre}</td>
                            <td className="text-status-danger font-black text-xs text-center">{item.cantidad}</td>
                            <td>
                              <span className={`badge ${item.estadoProducto === 'REINTEGRADO_STOCK' ? 'badge-ok' : 'badge-err'} font-black text-[8px] uppercase`}>
                                {item.estadoProducto.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="text-brand-gold-deep font-black text-xs text-right">{Utils.fmtUSD(item.cantidad * item.precioUnitUSD)}</td>
                            <td className="text-center">
                              <button onClick={() => setReturnItems(returnItems.filter((_, i) => i !== idx))} className="text-ink/20 hover:text-status-danger"><Trash2 className="w-3.5 h-3.5"/></button>
                            </td>
                          </tr>
                        ))}
                        {returnItems.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-10 text-ink/20 font-black uppercase italic text-[10px]">Añade productos para una devolución parcial</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="card bg-white border-line h-fit shadow-lg">
              <div className="card-head py-4 px-6 border-b border-line bg-surface-soft">
                <h3 className="text-ink font-black uppercase text-xs">Confirmar Devolución Parcial</h3>
              </div>
              <div className="card-body p-6 space-y-6">
                <div className="bg-surface-soft p-4 rounded-lg border border-line text-center shadow-inner">
                  <p className="text-ink/60 text-[9px] font-black uppercase mb-1">Total a Reembolsar</p>
                  <p className="text-3xl font-black text-status-danger">
                    {Utils.fmtUSD(returnItems.reduce((s, i) => s + (i.cantidad * i.precioUnitUSD), 0))}
                  </p>
                </div>

                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Método de Reembolso</label>
                  <select 
                    className="form-select bg-white text-ink h-11 text-xs font-black uppercase border-line shadow-sm rounded-md w-full px-3"
                    value={refundMethod}
                    onChange={e => setRefundMethod(e.target.value as any)}
                  >
                    <option value="EFECTIVO">Efectivo de Caja</option>
                    <option value="MISMO_METODO">Reverso (Mismo Método)</option>
                    <option value="CREDITO_TIENDA">Crédito / Vale Interno</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Motivo / Observaciones</label>
                  <textarea 
                    className="form-input bg-white text-ink text-xs min-h-[100px] border-line py-3"
                    placeholder="Describa el porqué de esta operación..."
                    value={reason}
                    onChange={e => setMotivo(e.target.value)}
                  ></textarea>
                </div>

                <div className="p-3 bg-status-danger-soft rounded border border-status-danger/20 flex gap-3">
                   <AlertTriangle className="w-5 h-5 text-status-danger shrink-0" />
                   <p className="text-[9px] text-ink font-bold leading-tight opacity-70">Esta acción generará una nota de crédito y ajustará el inventario. La factura original se mantendrá como parcialmente devuelta.</p>
                </div>

                <button 
                  disabled={returnItems.length === 0 || !reason.trim() || isProcessing}
                  onClick={procesarDevolucion}
                  className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl shadow-status-danger/10 disabled:opacity-20 transition-all flex items-center justify-center gap-2"
                >
                  {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar Devolución
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
