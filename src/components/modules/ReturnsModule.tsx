"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Return, Sale, ReturnItem, Movimiento, Anulacion, LibroDiarioEntry, PaymentMethod } from '@/lib/types';
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
  useEffect(() => {
    // Ventas y devoluciones históricas se cargan solo al entrar al módulo.
    Store.ensureLoaded('ventas');
    Store.ensureLoaded('devoluciones');
    Store.ensureLoaded('anulaciones');
  }, []);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [saleSearch, setSaleSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  type RefundPayment = { metodo: PaymentMethod; montoUSD: number; montoBS: number };
  const refundMethodCurrency = (metodo: PaymentMethod): 'BS' | 'USD' => ['efectivo_bs','punto_venta','pagomovil','biopago','transferencia'].includes(metodo) ? 'BS' : 'USD';
  const REFUND_METHODS: Array<{ value: PaymentMethod; label: string }> = [
    { value: 'efectivo_usd', label: 'Efectivo USD' }, { value: 'efectivo_bs', label: 'Efectivo BS' },
    { value: 'punto_venta', label: 'Punto de Venta' }, { value: 'pagomovil', label: 'Pago Móvil' },
    { value: 'biopago', label: 'Biopago' }, { value: 'transferencia', label: 'Transferencia' },
    { value: 'zelle', label: 'Zelle' }, { value: 'otros', label: 'Otros' }, { value: 'nota_credito', label: 'Nota de crédito' }
  ];
  const [refundPayments, setRefundPayments] = useState<RefundPayment[]>([{ metodo: 'efectivo_usd', montoUSD: 0, montoBS: 0 }]);
  const [showCancellationRefund, setShowCancellationRefund] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState(false);
  const [reason, setMotivo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });

  const buscarVenta = () => {
    const sale = state.ventas.find(v => (v.id === saleSearch || v.id.endsWith(saleSearch)) && (!terminalId || v.terminalId === terminalId));
    if (!sale) return alert('Venta no encontrada en este terminal.');
    if (sale.estado === 'anulada') return alert('Esta factura ya ha sido anulada previamente.');
    
    setSelectedSale(sale);
    setReturnItems([]);
    setRefundPayments([{ metodo: 'efectivo_usd', montoUSD: 0, montoBS: 0 }]);
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
    if (!selectedSale || returnItems.length === 0 || isProcessing || processingRef.current) return;
    if (!reason.trim()) return alert('Por favor indique el motivo de la devolución');

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const totalDevuelto = returnItems.reduce((s, i) => (s + (i.cantidad * i.precioUnitUSD)), 0);
      const saleIsCredit = String(selectedSale.metodoPago || '').toLowerCase() === 'credito' || String(selectedSale.type || '').toLowerCase() === 'credito';
      const salePaidUSD = Array.isArray(selectedSale.payments)
        ? selectedSale.payments.reduce((sum, p) => sum + (Number(p?.montoUSD) || 0), 0)
        : 0;

      // Una venta a crédito sin pagos no tiene dinero que devolver. La
      // devolución se registra como nota de crédito y reduce CxC; no toca caja.
      const refundPaymentsFinal = saleIsCredit && salePaidUSD <= 0.001
        ? []
        : refundPayments.map(p => ({
            ...p,
            montoUSD: refundMethodCurrency(p.metodo) === 'BS'
              ? (Number(p.montoBS) || 0) / (Number(state.tasa) || 1)
              : (Number(p.montoUSD) || 0),
            montoBS: refundMethodCurrency(p.metodo) === 'BS'
              ? (Number(p.montoBS) || 0)
              : (Number(p.montoUSD) || 0) * (Number(state.tasa) || 1)
          }));

      if (refundPaymentsFinal.length) {
        const refundTotal = refundPaymentsFinal.reduce((s, p) => s + (Number(p.montoUSD) || 0), 0);
        if (Math.abs(refundTotal - totalDevuelto) > 0.005) {
          alert('La distribución del reembolso debe sumar exactamente ' + Utils.fmtUSD(totalDevuelto) + '.');
          return;
        }
      }
      const terminal = state.terminales.find(t => t.id === terminalId);
      const prefijo = Utils.prefijoCaja(terminal, state.terminales);
      const idDev = 'DEV-OP-' + Store.uid().toUpperCase().slice(0, 10);
      const ahoraStr = Utils.ahora();

      const nuevaDevolucion: Return = {
        id: idDev,
        ventaId: selectedSale.id,
        fecha: ahoraStr,
        items: [...returnItems],
        totalUSD: totalDevuelto,
        metodoReembolso: refundPaymentsFinal.length === 0 ? 'nota_credito' : (refundPaymentsFinal.length === 1 ? refundPaymentsFinal[0].metodo : 'mixto'),
        refundPayments: refundPaymentsFinal,
        motivo: reason,
        terminalId: terminalId || 'GLOBAL'
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
        montoBS: refundPaymentsFinal.reduce((s, p) => s + (Number(p.montoBS) || 0), 0),
        metodo: refundPaymentsFinal.length === 1 ? refundPaymentsFinal[0].metodo : 'mixto',
        referencia: idDev,
        terminalId: terminalId || 'GLOBAL',
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL'
      };

      const resultadoDev = await Store.processReturnOrCancellationTransaction({ operationId: idDev, operationType: 'DEVOLUCION', saleId: selectedSale.id, operationDoc: nuevaDevolucion, movements: nuevosMovimientos, journal: nuevoAsiento, refundItems: returnItems });
      if (resultadoDev?.queuedOffline) { toast({ title: 'Devolución guardada sin conexión', description: 'Quedó pendiente de sincronización automática.' }); setView('list'); setSelectedSale(null); setReturnItems([]); return; }

      const devolucionFinal = resultadoDev?.operationDoc || nuevaDevolucion;
      updateState({
        devoluciones: [devolucionFinal, ...(state.devoluciones || [])],
        ventas: nuevasVentas,
        productos: Array.isArray(resultadoDev?.products) && resultadoDev.products.length
          ? state.productos.map(p => resultadoDev.products.find((rp:any) => String(rp.id) === String(p.id)) || p)
          : state.productos,
        movimientos: Array.isArray(resultadoDev?.movements) && resultadoDev.movements.length
          ? [...resultadoDev.movements, ...(state.movimientos || [])]
          : state.movimientos,
        cxc: resultadoDev?.debt
          ? state.cxc.map((d:any) => String(d.id) === String(resultadoDev.debt.id) ? resultadoDev.debt : d)
          : state.cxc,
        terminales: resultadoDev?.terminal?.id
          ? Utils.patchTerminal(state.terminales, resultadoDev.terminal.id, resultadoDev.terminal)
          : state.terminales,
        libroDiario: resultadoDev?.journal
          ? [resultadoDev.journal, ...(state.libroDiario || [])]
          : state.libroDiario
      });

      alert(`Devolución ${idDev} procesada con éxito`);
      setView('list');
      setSelectedSale(null);
      setReturnItems([]);
      setRefundPayments([{ metodo: 'efectivo_usd', montoUSD: 0, montoBS: 0 }]);
      setMotivo('');
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const ejecutarAnulacion = async (refundFinal: Array<{ metodo: PaymentMethod; montoUSD: number; montoBS: number }>) => {
    if (!selectedSale || isProcessing || processingRef.current) return;
    processingRef.current = true;
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
          nuevosMovimientos.push({ id: Store.uid(), productoId: item.productoId, tipo: 'anulacion', cantidad: item.cantidad, stockAntes, stockDespues: nuevosProductos[pIdx].stock, fecha: ahoraStr, referencia: `ANULACIÓN TOTAL FACTURA #${selectedSale.id}`, terminalId: terminalId || 'GLOBAL' });
        }
      });
      const nuevasVentas = state.ventas.map(v => v.id === selectedSale.id ? { ...v, estado: 'anulada' } : v);
      const terminal = state.terminales.find(t => t.id === terminalId);
      const idAnu = 'ANU-OP-' + Store.uid().toUpperCase().slice(0, 10);
      const nuevaAnulacion: Anulacion = {
        id: idAnu, ventaId: selectedSale.id, fecha: ahoraStr, totalUSD: selectedSale.totalUSD,
        motivo: 'ANULACIÓN TOTAL DE FACTURA POR OPERADOR', items: [...selectedSale.items], terminalId: terminalId || 'GLOBAL',
        ...(refundFinal.length ? { refundPayments: refundFinal, metodoReembolso: refundFinal.length === 1 ? refundFinal[0].metodo : 'mixto' } : {})
      };
      const nuevosAsientosDiario: LibroDiarioEntry[] = refundFinal.length ? [{
        id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5), fecha: ahoraStr, tipo: 'egreso', categoria: 'ANULACION',
        concepto: `REINTEGRO POR ANULACIÓN FACTURA #${selectedSale.id}`,
        montoUSD: refundFinal.reduce((s, p) => s + p.montoUSD, 0),
        montoBS: refundFinal.reduce((s, p) => s + p.montoBS, 0),
        metodo: refundFinal.length === 1 ? refundFinal[0].metodo : 'mixto', referencia: idAnu,
        terminalId: terminalId || 'GLOBAL', terminalName: terminal?.nombre || 'SISTEMA GLOBAL'
      }] : [];
      const resultadoAnu = await Store.processReturnOrCancellationTransaction({
        operationId: idAnu, operationType: 'ANULACION', saleId: selectedSale.id, operationDoc: nuevaAnulacion,
        movements: nuevosMovimientos, journal: nuevosAsientosDiario[0], fullCancellation: true
      });
      if (resultadoAnu?.queuedOffline) {
        toast({ title: 'Anulación guardada sin conexión', description: 'Quedó pendiente de sincronización automática.' });
        setView('list'); setSelectedSale(null); return;
      }
      const anulacionFinal = resultadoAnu?.operationDoc || nuevaAnulacion;
      updateState({
        ventas: nuevasVentas,
        anulaciones: [anulacionFinal, ...(state.anulaciones || [])],
        productos: Array.isArray(resultadoAnu?.products) && resultadoAnu.products.length
          ? state.productos.map(p => resultadoAnu.products.find((rp:any) => String(rp.id) === String(p.id)) || p)
          : state.productos,
        movimientos: Array.isArray(resultadoAnu?.movements) && resultadoAnu.movements.length
          ? [...resultadoAnu.movements, ...(state.movimientos || [])]
          : state.movimientos,
        cxc: resultadoAnu?.debt
          ? state.cxc.map((d:any) => String(d.id) === String(resultadoAnu.debt.id) ? resultadoAnu.debt : d)
          : state.cxc,
        terminales: resultadoAnu?.terminal?.id ? Utils.patchTerminal(state.terminales, resultadoAnu.terminal.id, resultadoAnu.terminal) : state.terminales,
        libroDiario: resultadoAnu?.journal
          ? [resultadoAnu.journal, ...(state.libroDiario || [])]
          : state.libroDiario
      });
      toast({ title: "Factura Anulada", description: `El documento ${selectedSale.id} ha sido invalidado bajo el registro ${idAnu}.` });
      setView('list'); setSelectedSale(null); setRefundPayments([{ metodo: 'efectivo_usd', montoUSD: 0, montoBS: 0 }]);
      setShowCancellationRefund(false); setPendingCancellation(false);
    } finally {
      processingRef.current = false; setIsProcessing(false);
    }
  };

  const anularFacturaCompleta = async () => {
    if (!selectedSale || isProcessing || processingRef.current) return;
    const pin = prompt('AUTORIZACIÓN REQUERIDA: Ingrese PIN de Seguridad:');
    if (pin !== state.pinDevolucion) return alert('PIN Incorrecto');
    if (!confirm(`¿ESTÁ SEGURO DE ANULAR LA FACTURA ${selectedSale.id}?\nEsta acción devolverá todo el stock al inventario.`)) return;
    const saleIsCredit = String(selectedSale.metodoPago || '').toLowerCase() === 'credito' || String(selectedSale.type || '').toLowerCase() === 'credito';
    const salePaidUSD = Array.isArray(selectedSale.payments)
      ? selectedSale.payments.reduce((sum, p) => sum + (Number(p?.montoUSD) || 0), 0)
      : 0;

    // Si es crédito y no hubo pagos, la anulación cancela la obligación
    // restante. No se pregunta por un reintegro de efectivo porque no existe
    // dinero pagado que devolver.
    if (saleIsCredit && salePaidUSD <= 0.001) {
      await ejecutarAnulacion([]);
      return;
    }

    const representaEgreso = confirm("¿Esta anulación requiere el REINTEGRO DE DINERO físico al cliente?\n(Si confirma, se solicitará la distribución por método de pago)");
    if (representaEgreso) {
      setRefundPayments([{ metodo: (selectedSale.metodoPago || 'efectivo_usd') as PaymentMethod, montoUSD: Number(selectedSale.totalUSD) || 0, montoBS: (Number(selectedSale.totalUSD) || 0) * (Number(state.tasa) || 1) }]);
      setPendingCancellation(true); setShowCancellationRefund(true); return;
    }
    await ejecutarAnulacion([]);
  };

  const historialUnificado = useMemo(() => {
    const enRango = (f: string) => f && f.slice(0, 10) >= rango.desde && f.slice(0, 10) <= rango.hasta;
    // La lista operativa de la jornada empieza después del último Z de ESTA caja.
    // No borramos documentos históricos de Firestore: quedan disponibles para
    // trazabilidad, pero la nueva jornada arranca limpia aunque el Z se haga
    // durante el mismo día.
    const terminal = state.terminales.find(t => t.id === terminalId);
    const corteTimestamp = terminal?.fechaUltimoZ || '';
    const enJornadaActual = (fecha: string) => !corteTimestamp || fecha > corteTimestamp;

    const devs = (state.devoluciones || [])
      .filter(d => (!terminalId || state.ventas.find(v => v.id === d.ventaId)?.terminalId === terminalId) && enRango(d.fecha) && enJornadaActual(d.fecha))
      .map(d => ({ ...d, tipoOperacion: 'DEVOLUCIÓN' }));
    
    const anus = (state.anulaciones || [])
      .filter(a => (!terminalId || state.ventas.find(v => v.id === a.ventaId)?.terminalId === terminalId) && enRango(a.fecha) && enJornadaActual(a.fecha))
      .map(a => ({ ...a, tipoOperacion: 'ANULACIÓN', items: a.items || [] }));
    
    return [...devs, ...anus].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [state.devoluciones, state.anulaciones, state.ventas, state.terminales, terminalId, rango]);

  return (
    <div className="space-y-6 max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
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
          <div className="table-wrap max-h-[38vh] overflow-y-auto">
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
                  <div className="table-wrap max-h-[38vh] overflow-y-auto">
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
                  <div className="table-wrap max-h-[38vh] overflow-y-auto">
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
                  <p className="text-sm font-black text-ink/60 mt-1">
                    Equiv. BS: {Utils.fmtBS(returnItems.reduce((s, i) => s + (i.cantidad * i.precioUnitUSD), 0) * (Number(state.tasa) || 1))}
                  </p>
                </div>

                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-2">Método(s) de Reembolso</label>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {refundPayments.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_110px_32px] gap-2 items-center">
                        <select className="form-select bg-white text-ink h-10 text-[10px] font-black uppercase border-line rounded-md px-2" value={p.metodo} onChange={e => setRefundPayments(refundPayments.map((x,i)=>i===idx?{...x,metodo:e.target.value as PaymentMethod}:x))}>
                          {REFUND_METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" value={(refundMethodCurrency(p.metodo) === 'BS' ? p.montoBS : p.montoUSD) || ''} placeholder={refundMethodCurrency(p.metodo) === 'BS' ? 'BS' : 'USD'} onChange={e => setRefundPayments(refundPayments.map((x,i)=>i===idx
                          ? (refundMethodCurrency(x.metodo) === 'BS'
                            ? {...x,montoBS:Number(e.target.value)||0,montoUSD:(Number(e.target.value)||0)/(Number(state.tasa)||1)}
                            : {...x,montoUSD:Number(e.target.value)||0,montoBS:(Number(e.target.value)||0)*(Number(state.tasa)||1)})
                          : x))} className="form-input h-10 text-xs font-black text-right" />
                        <button type="button" onClick={()=>setRefundPayments(refundPayments.filter((_,i)=>i!==idx))} disabled={refundPayments.length===1} className="h-9 text-ink/30 hover:text-status-danger disabled:opacity-20"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={()=>setRefundPayments([...refundPayments,{metodo:'efectivo_usd',montoUSD:0,montoBS:0}])} className="mt-2 text-[9px] font-black uppercase text-status-info">+ Agregar otro método</button>
                  <div className="mt-2 flex justify-between text-[9px] font-black uppercase"><span>Distribuido: {Utils.fmtUSD(refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0))}</span><span>Falta: {Utils.fmtUSD(Math.max(0,returnItems.reduce((s,i)=>s+i.cantidad*i.precioUnitUSD,0)-refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0)))}</span></div>
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
      {showCancellationRefund && pendingCancellation && selectedSale && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-line max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 bg-white border-b border-line px-6 py-4 flex items-center justify-between">
              <div><h3 className="text-ink font-black uppercase text-sm">Reintegro por Anulación</h3><p className="text-[10px] text-ink/50 font-bold uppercase mt-1">Factura {selectedSale.id} · Seleccione uno o varios métodos</p></div>
              <button type="button" onClick={() => { setShowCancellationRefund(false); setPendingCancellation(false); }} className="text-ink/40 hover:text-status-danger"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="p-4 rounded-lg bg-surface-soft border border-line">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-ink/60">Total a reintegrar</span>
                  <span className="text-2xl font-black text-status-danger">{Utils.fmtUSD(selectedSale.totalUSD)}</span>
                </div>
                <div className="text-right text-sm font-black text-ink/60 mt-1">
                  Equiv. BS: {Utils.fmtBS((Number(selectedSale.totalUSD) || 0) * (Number(state.tasa) || 1))}
                </div>
              </div>
              <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                {refundPayments.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_36px] gap-2 items-center">
                    <select className="form-select bg-white text-ink h-10 text-[10px] font-black uppercase border-line rounded-md px-2" value={p.metodo} onChange={e => setRefundPayments(refundPayments.map((x,i)=>i===idx?{...x,metodo:e.target.value as PaymentMethod}:x))}>{REFUND_METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select>
                    <input type="number" min="0" step="0.01" value={(refundMethodCurrency(p.metodo) === 'BS' ? p.montoBS : p.montoUSD) || ''} onChange={e => setRefundPayments(refundPayments.map((x,i)=>i===idx?(refundMethodCurrency(p.metodo) === 'BS'?{...x,montoBS:Number(e.target.value)||0,montoUSD:(Number(e.target.value)||0)/(Number(state.tasa)||1)}:{...x,montoUSD:Number(e.target.value)||0,montoBS:(Number(e.target.value)||0)*(Number(state.tasa)||1)}):x))} className="form-input h-10 text-xs font-black text-right" placeholder={refundMethodCurrency(p.metodo) === 'BS' ? 'BS' : 'USD'} />
                    <button type="button" onClick={()=>setRefundPayments(refundPayments.filter((_,i)=>i!==idx))} disabled={refundPayments.length===1} className="h-9 text-ink/30 hover:text-status-danger disabled:opacity-20"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={()=>setRefundPayments([...refundPayments,{metodo:'efectivo_usd',montoUSD:0,montoBS:0}])} className="text-[9px] font-black uppercase text-status-info">+ Agregar otro método</button>
              <div className="flex justify-between text-[9px] font-black uppercase border-t border-line pt-3"><span>Distribuido: {Utils.fmtUSD(refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0))}</span><span className={Math.abs(refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0)-(Number(selectedSale.totalUSD)||0))<0.005 ? 'text-status-ok' : 'text-status-danger'}>Falta: {Utils.fmtUSD(Math.max(0,(Number(selectedSale.totalUSD)||0)-refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0)))}</span></div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={()=>{setShowCancellationRefund(false);setPendingCancellation(false)}} className="btn btn-secondary h-10 px-5 font-black uppercase text-[10px]">Cancelar</button>
                <button type="button" disabled={isProcessing || Math.abs(refundPayments.reduce((s,p)=>s+(refundMethodCurrency(p.metodo)==='BS'?Number(p.montoBS)/(Number(state.tasa)||1):Number(p.montoUSD)||0),0)-(Number(selectedSale.totalUSD)||0))>0.005} onClick={()=>ejecutarAnulacion(refundPayments.map(p=>({...p,montoUSD:Number(p.montoUSD)||0,montoBS:(Number(p.montoUSD)||0)*state.tasa})))} className="btn btn-danger h-10 px-5 font-black uppercase text-[10px] disabled:opacity-30">{isProcessing?'PROCESANDO...':'CONFIRMAR ANULACIÓN Y REINTEGRO'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
