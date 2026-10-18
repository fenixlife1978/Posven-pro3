'use client';

import React, { useEffect, useState, useRef } from 'react';
import { AppState, LibroDiarioEntry, PaymentMethod, Debt } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { 
  FileText, 
  Calculator, 
  Eye, 
  X, 
  Banknote,
  Search,
  Plus,
  ArrowLeft,
  Calendar,
  ClipboardList,
  User,
  DollarSign,
  FilePlus,
  Save,
  ChevronDown,
  ChevronRight,
  Layers,
  Trash2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { exportarPDFCxP } from '@/lib/pdf-generator';
import { Pagination } from '@/components/ui/pagination';

interface CxPModuleProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
  terminalId?: string;
}

export default function CxPModule({ state, updateState, terminalId }: CxPModuleProps) {
  useEffect(() => { Store.ensureLoaded('cxp'); }, []);
  const [showDetails, setShowDetails] = useState<any>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo_usd');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [vista, setVista] = useState<'grupo' | 'factura'>('grupo');
  const [grupoExpandido, setGrupoExpandido] = useState<string | null>(null);
  const [globalProvider, setGlobalProvider] = useState<any>(null);
  const [histProveedor, setHistProveedor] = useState('');
  const [histDesde, setHistDesde] = useState('');
  const [histHasta, setHistHasta] = useState('');

  // Estado para "Registrar Pago Atrasado" (pago global con fecha y tasa BCV pasadas).
  const [pagoAtrasado, setPagoAtrasado] = useState(false);
  const [pagoAtrasadoFecha, setPagoAtrasadoFecha] = useState(Utils.hoy());
  const [pagoAtrasadoTasa, setPagoAtrasadoTasa] = useState('');

  // Estado para el modal de Deuda Directa
  const [showDeudaDirectaModal, setShowDeudaDirectaModal] = useState(false);
  const [proveedorSearch, setProveedorSearch] = useState('');
  const [selectedProveedor, setSelectedProveedor] = useState('');
  const [deudaMonto, setDeudaMonto] = useState('');
  const [deudaMotivo, setDeudaMotivo] = useState('');
  const [fechaDeuda, setFechaDeuda] = useState(Utils.hoy());
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // Una cuenta SOLO representa deuda activa cuando tiene monto real y saldo real
  // pendiente. Un monto $0.00 (o menor/despreciable) es NEUTRO: no es deuda por
  // pagar. Un saldo $0.00 (o despreciable) la convierte en PAGADA, aunque por un
  // residuo/redondeo no haya quedado marcada como 'pagada'.
  const esDeudaActiva = (x: Debt) =>
    (x.montoUSD || 0) > 0.001 &&
    (x.saldoUSD || 0) > 0.001 &&
    x.estado !== 'pagada';

  const pendientes = (state.cxp || []).filter(esDeudaActiva);
  const totalPendiente = pendientes.reduce((s: number, x: Debt) => s + x.saldoUSD, 0);

  // Si el residuo en USD es menor a un centavo pero todavía representa
  // bolívares por la tasa vigente, mostramos ambos importes para no ocultar
  // diferencias de redondeo: "$0.00 (Bs. 2,06)".
  const fmtSaldoCxP = (saldoUSD: number) => {
    const usd = Number(saldoUSD) || 0;
    const bs = usd * (Number(state.tasa) || 0);
    const usdVisible = Utils.fmtUSD(usd);
    if (usd > 0 && usdVisible === '$0.00' && bs > 0) {
      return `${usdVisible} (${Utils.fmtBS(bs)})`;
    }
    return usdVisible;
  };

  // Agrupar cuentas por pagar por proveedor (SOLO las que tienen deuda real activa,
  // excluyendo pagadas/neutrales de $0.00, en orden cronológico).
  const gruposProveedor = React.useMemo(() => {
    const map = new Map<string, { proveedor: string; pendientes: Debt[]; saldoTotal: number }>();
    (state.cxp || []).forEach((d: Debt) => {
      if (!esDeudaActiva(d)) return;
      const key = (d.proveedor || 'SIN PROVEEDOR').trim().toUpperCase();
      if (!map.has(key)) map.set(key, { proveedor: key, pendientes: [], saldoTotal: 0 });
      const g = map.get(key)!;
      g.pendientes.push(d);
      g.saldoTotal += d.saldoUSD;
    });
    return Array.from(map.values())
      .map(g => ({ ...g, pendientes: g.pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha)) }))
      .sort((a, b) => a.proveedor.localeCompare(b.proveedor));
  }, [state.cxp]);

  // HISTORIAL DE PAGOS: solo deudas con al menos un pago registrado, filtrables
  // por proveedor y por rango de fechas de pago (desde - hasta).
  const proveedoresHistorial: string[] = Array.from(new Set(
    (state.cxp || []).map((x: Debt) => (x.proveedor || 'SIN PROVEEDOR').trim().toUpperCase())
  )).sort((a, b) => a.localeCompare(b));

  const historialFiltrado = React.useMemo(() => {
    const desde = histDesde ? histDesde.replace(/-/g, '') : '';
    const hasta = histHasta ? histHasta.replace(/-/g, '') : '';
    const prov = histProveedor.toUpperCase();
    return (state.cxp || [])
      .filter((x: Debt) => {
        if (!x.historialPagos || x.historialPagos.length === 0) return false;
        if (prov && (x.proveedor || 'SIN PROVEEDOR').toUpperCase() !== prov) return false;
        // El rango de fechas aplica sobre los abonos realizados: si algún pago
        // cae dentro de [desde, hasta], la factura se incluye.
        const enRango = x.historialPagos.some((p: any) => {
          const d = (p.fecha || '').slice(0, 10).replace(/-/g, '');
          if (desde && d < desde) return false;
          if (hasta && d > hasta) return false;
          return true;
        });
        if (desde || hasta) return enRango;
        return true;
      })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [state.cxp, histProveedor, histDesde, histHasta]);

  const histTotalPago = historialFiltrado.reduce(
    (s: number, x: Debt) => s + (x.abonadoUSD || 0), 0);
  const histTotalPages = Math.max(1, Math.ceil(historialFiltrado.length / pageSize));
  const histSafePage = Math.min(page, histTotalPages);
  const histPageData = historialFiltrado.slice((histSafePage - 1) * pageSize, histSafePage * pageSize);

  // Obtener proveedores únicos de las compras recibidas
  const proveedoresExistentes: string[] = state.proveedores && Array.isArray(state.proveedores)
    ? state.proveedores.map((p: any) => p.name || p.nombre || 'PROVEEDOR SIN NOMBRE')
    : [];

  // Filtrar proveedores según búsqueda
  const proveedoresFiltrados = proveedoresExistentes.filter((p: string) => 
    p.toLowerCase().includes(proveedorSearch.toLowerCase())
  );

  const handleOpenPayment = (debt: any) => {
    setShowPaymentModal(debt);
    setPaymentAmount('');
    setPaymentMethod('efectivo_usd');
  };

  const handleProcessPayment = async () => {
    const esMetodoBS = paymentMethod === 'efectivo_bs' || paymentMethod === 'pagomovil';
    const rawMonto = parseFloat(paymentAmount) || 0;
    if (rawMonto <= 0) {
      toast({ variant: "destructive", title: "Error", description: "El monto debe ser mayor a cero." });
      return;
    }
    const montoBS = esMetodoBS ? rawMonto : rawMonto * state.tasa;
    const amount = esMetodoBS ? rawMonto / state.tasa : rawMonto;
    const amountCents = Math.round(amount * 100);
    const saldoCents = Math.round((Number(showPaymentModal.saldoUSD) || 0) * 100);
    if (amountCents > saldoCents) {
      toast({ variant: "destructive", title: "Error", description: "El monto no puede ser mayor al saldo pendiente." });
      return;
    }
    const amountNormalizado = amountCents / 100;

    if (isProcessing || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    const ahoraStr = Utils.ahora();
    const asientoId = 'ACC-' + Store.uid().toUpperCase().slice(0, 5);
    const reciboId = `PEND-CXP-${Store.uid().toUpperCase().slice(0, 8)}`;
    const pago = {
      id: 'PAYS-' + Store.uid().toUpperCase().slice(0, 6),
      asientoId, fecha: ahoraStr, montoUSD: amountNormalizado, montoBS,
      metodo: paymentMethod, reciboId
    };
    const nuevoAsiento: LibroDiarioEntry = {
      id: asientoId, fecha: ahoraStr, tipo: 'egreso',
      categoria: 'PAGO_PROVEEDOR' as any,
      concepto: `PAGO DEUDA A: ${showPaymentModal.proveedor.toUpperCase()} - REF FACT: ${showPaymentModal.numeroFactura || 'S/N'}`,
      montoUSD: amountNormalizado, montoBS, metodo: paymentMethod, referencia: showPaymentModal.id
    };

    try {
      const resultadoPago = await Store.applyDebtPaymentTransaction({
        collection: 'cxp',
        debtId: showPaymentModal.id,
        amountUSD: amountNormalizado,
        payment: { ...pago, montoUSD: amountNormalizado },
        journal: nuevoAsiento
      });
      if (!resultadoPago) throw new Error('No se pudo registrar el pago al proveedor.');
      if (resultadoPago.queuedOffline) { toast({ title: 'Pago guardado sin conexión', description: 'Quedó pendiente y se sincronizará automáticamente al regresar Internet.' }); setShowPaymentModal(null); setPaymentAmount(''); return; }
      toast({ title: "Pago registrado", description: `Se abonó ${Utils.fmtUSD(amountNormalizado)}${esMetodoBS ? ' (' + Utils.fmtBS(rawMonto) + ')' : ''} a ${showPaymentModal.proveedor.toUpperCase()}` });
      setShowPaymentModal(null);
      setPaymentAmount('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo registrar el pago", description: e?.message || 'La deuda cambió en otra caja. Actualice y vuelva a intentar.' });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleOpenGlobalPayment = (provider: string) => {    const grupo = gruposProveedor.find(g => g.proveedor === provider);
    if (!grupo) return;
    const total = grupo.saldoTotal;
    if (total <= 0) return;
    setGlobalProvider({ proveedor: provider, total });
    setPaymentAmount('');
    setPaymentMethod('efectivo_usd');
    setPagoAtrasado(false);
    setPagoAtrasadoFecha(Utils.hoy());
    setPagoAtrasadoTasa('');
  };

  const handleProcessGlobalPayment = async () => {
    if (!globalProvider || isProcessing || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    const esMetodoBS = paymentMethod === 'efectivo_bs' || paymentMethod === 'pagomovil';
    const rawMonto = parseFloat(paymentAmount) || 0;
    if (rawMonto <= 0) {
      toast({ variant: "destructive", title: "Error", description: "El monto debe ser mayor a cero." });
      return;
    }

    const tasaAplicada = pagoAtrasado ? (parseFloat(pagoAtrasadoTasa) || state.tasa) : state.tasa;
    if (!(tasaAplicada > 0)) {
      toast({ variant: "destructive", title: "Error", description: "La tasa BCV debe ser mayor que cero." });
      return;
    }

    const montoBS = esMetodoBS ? rawMonto : rawMonto * tasaAplicada;
    const amount = esMetodoBS ? rawMonto / tasaAplicada : rawMonto;
    const fechaPago = pagoAtrasado && pagoAtrasadoFecha
      ? pagoAtrasadoFecha + 'T' + Utils.ahora().split('T')[1]
      : Utils.ahora();

    const grupo = gruposProveedor.find(g => g.proveedor === globalProvider.proveedor);
    if (!grupo || grupo.pendientes.length === 0) {
      toast({ variant: "destructive", title: "Sin deuda pendiente", description: "Las deudas de este proveedor ya fueron actualizadas por otra caja." });
      return;
    }

    const reciboBase = `PEND-CXP-${Store.uid().toUpperCase().slice(0, 8)}`;
    const asientoId = 'ACC-' + Store.uid().toUpperCase().slice(0, 5);
    const pagoBase = {
      id: 'PAYS-' + Store.uid().toUpperCase().slice(0, 6),
      asientoId,
      fecha: fechaPago,
      montoUSD: amount,
      montoBS: montoBS,
      metodo: paymentMethod,
      reciboId: reciboBase,
      tasaAplicada
    };
    const nuevoAsiento: LibroDiarioEntry = {
      id: asientoId,
      fecha: fechaPago,
      tipo: 'egreso',
      categoria: 'PAGO_PROVEEDOR' as any,
      concepto: `PAGO GLOBAL A: ${globalProvider.proveedor} - LIQUIDACIÓN POR ORDEN DE ANTIGÜEDAD${pagoAtrasado ? ` - PAGO ATRASADO (TASA ${tasaAplicada.toFixed(2)})` : ''}`,
      montoUSD: amount,
      montoBS: montoBS,
      metodo: paymentMethod,
      referencia: reciboBase
    };

    try {
      const resultadoPago = await Store.applyGlobalProviderPaymentTransaction({
        provider: globalProvider.proveedor,
        amountUSD: amount,
        payment: pagoBase,
        journal: nuevoAsiento
      });

      if (resultadoPago.queuedOffline) { toast({ title: 'Pago global guardado sin conexión', description: 'Quedó pendiente y se sincronizará automáticamente al regresar Internet.' }); return; }

      const totalAplicado = resultadoPago.appliedUSD;
      if (totalAplicado <= 0.001) {
        throw new Error('El saldo del proveedor cambió en otra caja. Actualice la pantalla y vuelva a intentar.');
      }

      const remanente = Math.max(0, amount - totalAplicado);
      const aplicados = resultadoPago.debts;
      const aplicadoBS = Number(resultadoPago.appliedBS) > 0 ? Number(resultadoPago.appliedBS) : totalAplicado * tasaAplicada;

      toast({
        title: "Pago global registrado",
        description: `${Utils.fmtUSD(totalAplicado)}${esMetodoBS ? ' (' + Utils.fmtBS(aplicadoBS) + ')' : ''} aplicado a ${aplicados.length} deuda(s)${remanente > 0.001 ? ' (excedente sin aplicar)' : ''}${pagoAtrasado ? ' · Pago atrasado registrado' : ''}`
      });

      setGlobalProvider(null);
      setPaymentAmount('');
      setPagoAtrasado(false);
      setPagoAtrasadoFecha(Utils.hoy());
      setPagoAtrasadoTasa('');
      setGrupoExpandido(globalProvider.proveedor);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "No se pudo registrar el pago global",
        description: e?.message || 'No se pudo completar la operación contra Turso.'
      });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Eliminar un abono/pago del historial: revierte TODOS los movimientos causados
  // (restaura la deuda, quita el abono, y revierte el asiento contable del ingreso/egreso).
  const handleEliminarPago = async (deuda: any, idx: number) => {
    if (isProcessing || processingRef.current) return;
    const pago = (deuda.historialPagos || [])[idx];
    if (!pago) return;
    if (!confirm(`¿Seguro que desea eliminar el abono de ${Utils.fmtUSD(pago.montoUSD)} (${Utils.metodoLabel(pago.metodo || 'otros')})?\\nSe revertirán la deuda y el asiento contable correspondiente.`)) return;

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const resultado = await Store.reverseDebtPaymentTransaction({
        collection: 'cxp',
        debtId: deuda.id,
        paymentId: String(pago.id || ''),
        journalId: pago.asientoId ? String(pago.asientoId) : undefined
      });
      if (!resultado) throw new Error('No se pudo revertir el abono.');
      if (resultado.queuedOffline) { toast({ title: 'Reverso guardado sin conexión', description: 'La reversión quedó pendiente de sincronización.' }); return; }
      toast({
        title: "Abono eliminado",
        description: `Se revirtió el abono de ${Utils.fmtUSD(pago.montoUSD)}. La deuda quedó en ${Utils.fmtUSD(resultado.saldoUSD)}.`
      });
      if (showDetails && showDetails.id === deuda.id) setShowDetails(resultado);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar el abono",
        description: e?.message || 'La deuda cambió en otra caja. Actualice y vuelva a intentar.'
      });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleGuardarDeudaDirecta = async () => {
    if (isProcessing || processingRef.current) return;
    if (!selectedProveedor) {
      toast({ variant: "destructive", title: "Error", description: "Debe seleccionar un proveedor." });
      return;
    }
    const monto = parseFloat(deudaMonto) || 0;
    if (monto <= 0) {
      toast({ variant: "destructive", title: "Error", description: "El monto debe ser mayor a cero." });
      return;
    }
    if (!deudaMotivo.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Debe ingresar un motivo para la deuda." });
      return;
    }

    const nuevaDeuda: any = {
      id: 'CXP-' + Store.uid().toUpperCase().slice(0, 6),
      fecha: fechaDeuda,
      fechaVencimiento: fechaDeuda,
      proveedor: selectedProveedor,
      numeroFactura: `DEUDA-DIRECTA-${Store.uid().toUpperCase().slice(0, 4)}`,
      montoUSD: monto,
      abonadoUSD: 0,
      saldoUSD: monto,
      estado: 'pendiente' as 'pendiente',
      motivo: deudaMotivo,
      items: [],
      historialPagos: []
    };
    const nuevoAsiento: LibroDiarioEntry = {
      id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
      fecha: Utils.ahora(),
      tipo: 'egreso',
      categoria: 'DEUDA_PROVEEDOR' as any,
      concepto: `DEUDA DIRECTA A: ${selectedProveedor.toUpperCase()} - ${deudaMotivo}`,
      montoUSD: monto,
      montoBS: monto * state.tasa,
      metodo: 'efectivo_usd',
      referencia: nuevaDeuda.id
    };

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const resultadoDeuda = await Store.createSupplierDebtTransaction({ debt: nuevaDeuda, journal: nuevoAsiento });
      if (resultadoDeuda?.queuedOffline) { toast({ title: 'Deuda guardada sin conexión', description: 'Quedó pendiente y se sincronizará automáticamente.' }); return; }
      toast({ title: "Deuda registrada", description: `Se ha registrado la deuda de ${Utils.fmtUSD(monto)} a ${selectedProveedor}` });
      setShowDeudaDirectaModal(false);
      setSelectedProveedor('');
      setDeudaMonto('');
      setDeudaMotivo('');
      setProveedorSearch('');
      setFechaDeuda(Utils.hoy());
    } catch (e: any) {      toast({ variant: "destructive", title: "No se pudo registrar la deuda", description: e?.message || 'La información cambió en otra caja. Actualice y vuelva a intentar.' });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-black text-primary">Cuentas por Pagar</h2>
          <p className="text-[10px] text-ink font-black uppercase tracking-widest">Control de Obligaciones con Proveedores</p>
        </div>
        <button 
          onClick={() => setShowDeudaDirectaModal(true)} 
          className="btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-lg"
        >
          <FilePlus className="w-4 h-4" /> Agregar Deuda Directa
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-ink">
          <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Facturas Pendientes</div>
          <div className="text-4xl font-black text-ink">{pendientes.length}</div>
          <div className="text-ink text-[10px] font-black mt-1.5 uppercase tracking-widest">Compromisos por Liquidar</div>
        </div>
        <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-status-danger">
          <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Total a Pagar (USD)</div>
          <div className="text-4xl font-black text-status-danger">{Utils.fmtUSD(totalPendiente)}</div>
          <div className="text-ink font-black text-sm mt-1.5">{Utils.fmtBS(totalPendiente * state.tasa)}</div>
        </div>
      </div>

<div className="card shadow-md border-line overflow-hidden bg-white rounded-xl">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <Calculator className="w-5 h-5 text-brand-gold" /> CUENTAS POR PAGAR ACTIVAS
          </h3>
          <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1">
            <button
              onClick={() => setVista('grupo')}
              className={`px-4 py-1.5 rounded-md font-black uppercase text-[9px] transition-colors flex items-center gap-1.5 ${vista === 'grupo' ? 'bg-brand-gold text-ink shadow' : 'text-white/60 hover:text-white'}`}
            >
              <Layers className="w-3.5 h-3.5" /> Por Proveedor
            </button>
            <button
              onClick={() => setVista('factura')}
              className={`px-4 py-1.5 rounded-md font-black uppercase text-[9px] transition-colors flex items-center gap-1.5 ${vista === 'factura' ? 'bg-brand-gold text-ink shadow' : 'text-white/60 hover:text-white'}`}
            >
              <FileText className="w-3.5 h-3.5" /> Historial Pagos
            </button>
          </div>
        </div>

        {vista === 'grupo' ? (
          <div className="p-4 sm:p-6">
            {gruposProveedor.length === 0 ? (
              <div className="text-center py-24 text-ink font-black uppercase italic tracking-widest">
                No se registran cuentas por pagar actualmente
              </div>
            ) : (
              <div className="space-y-4">
                {gruposProveedor.map(g => (
                  <div key={g.proveedor} className="border border-line rounded-xl overflow-hidden bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-surface-soft/60 border-b border-line">
                      <button
                        onClick={() => setGrupoExpandido(grupoExpandido === g.proveedor ? null : g.proveedor)}
                        className="flex items-center gap-3 text-left flex-1 min-w-0"
                      >
                        {grupoExpandido === g.proveedor
                          ? <ChevronDown className="w-5 h-5 text-brand-gold-deep shrink-0" />
                          : <ChevronRight className="w-5 h-5 text-brand-gold-deep shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-black uppercase text-ink truncate">{g.proveedor}</p>
                          <p className="text-[9px] font-black uppercase text-ink/50 tracking-widest">
                            {g.pendientes.length} factura(s) pendiente(s) · Tot. {Utils.fmtUSD(g.saldoTotal)}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-black text-status-danger mono">{Utils.fmtUSD(g.saldoTotal)}</span>
                        <button
                          onClick={() => handleOpenGlobalPayment(g.proveedor)}
                          disabled={g.saldoTotal <= 0}
                          className="btn btn-primary h-8 px-4 font-black text-[9px] uppercase shadow-sm"
                          title="Pago global: liquida deudas en orden cronológico"
                        >
                          Pago Global
                        </button>
                      </div>
                    </div>

                    {grupoExpandido === g.proveedor && (
                      <div className="table-wrap">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-surface-soft">
                              <th className="text-ink font-black text-[10px] uppercase py-3 px-6 border-b border-line">Fecha</th>
                              <th className="text-ink font-black text-[10px] uppercase py-3 border-b border-line">Venc.</th>
                              <th className="text-ink font-black text-[10px] uppercase py-3 border-b border-line">Factura</th>
                              <th className="text-ink font-black text-[10px] uppercase py-3 text-right border-b border-line">Monto USD</th>
                              <th className="text-ink font-black text-[10px] uppercase py-3 text-right border-b border-line">Saldo</th>
                              <th className="text-ink font-black text-[10px] uppercase px-6 text-center border-b border-line">Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.pendientes.length === 0 ? (
                              <tr><td colSpan={6} className="py-12 text-center text-ink font-black uppercase italic text-[10px]">Sin deudas pendientes</td></tr>
                            ) : (
                              g.pendientes.map((x: Debt) => (
                                <tr key={x.id} className="border-b border-line/40 hover:bg-surface-warm/20 transition-colors">
                                  <td className="text-ink font-black text-xs py-3 px-6">{Utils.fmtFecha(x.fecha)}</td>
                                  <td className={`text-xs font-black py-3 ${x.fechaVencimiento < Utils.hoy() && x.estado !== 'pagada' ? 'text-status-danger' : 'text-ink'}`}>
                                    {Utils.fmtFecha(x.fechaVencimiento)}
                                  </td>
                                  <td className="text-ink font-black text-xs py-3 mono">{x.numeroFactura || '-'}</td>
                                  <td className="text-ink font-black text-xs text-right py-3 mono">{Utils.fmtUSD(x.montoUSD)}</td>
                                  <td className="text-brand-gold-deep font-black text-sm text-right py-3 mono">{fmtSaldoCxP(x.saldoUSD)}</td>
                                  <td className="py-3 px-6 text-center">
                                    <div className="flex justify-center items-center gap-3">
                                      <button onClick={() => setShowDetails(x)} className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md" title="Ver Historial Detallado">
                                        <Eye className="w-4 h-4" />
                                      </button>
                                      {x.estado !== 'pagada' && (
                                        <button onClick={() => handleOpenPayment(x)} className="btn btn-primary h-8 px-4 font-black text-[9px] uppercase shadow-sm">Pagar</button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* FILTROS DEL HISTORIAL */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 sm:px-6 pt-4">
              <div className="form-group">
                <label className="text-ink text-[9px] font-black uppercase block mb-1">Proveedor</label>
                <select
                  className="form-select h-10 text-xs font-black uppercase border-line bg-surface-soft/50 text-ink w-full"
                  value={histProveedor}
                  onChange={e => { setHistProveedor(e.target.value); setPage(1); }}
                >
                  <option value="">Todos los proveedores</option>
                  {proveedoresHistorial.map(p => (
                    <option key={p} value={p.toUpperCase()}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="text-ink text-[9px] font-black uppercase block mb-1">Desde</label>
                <input
                  type="date"
                  className="form-input h-10 text-xs font-black text-ink w-full"
                  value={histDesde}
                  onChange={e => { setHistDesde(e.target.value); setPage(1); }}
                />
              </div>
              <div className="form-group">
                <label className="text-ink text-[9px] font-black uppercase block mb-1">Hasta</label>
                <input
                  type="date"
                  className="form-input h-10 text-xs font-black text-ink w-full"
                  value={histHasta}
                  onChange={e => { setHistHasta(e.target.value); setPage(1); }}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 px-4 sm:px-6 pt-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-ink/50">
                {historialFiltrado.length} factura(s) · Total pagado {Utils.fmtUSD(histTotalPago)}
              </p>
              {(histProveedor || histDesde || histHasta) && (
                <button
                  onClick={() => { setHistProveedor(''); setHistDesde(''); setHistHasta(''); setPage(1); }}
                  className="text-[9px] font-black uppercase text-status-danger hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line">Fecha</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Proveedor</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Factura</th>                    <th className="text-ink font-black text-[10px] uppercase py-4 text-right border-b border-line">Monto USD</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 text-right border-b border-line">Pagado</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 text-center border-b border-line">Abonos</th>
                    <th className="text-ink font-black text-[10px] uppercase px-6 text-center border-b border-line">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {historialFiltrado.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16 text-ink font-black uppercase italic tracking-widest">
                        No hay pagos registrados{histProveedor || histDesde || histHasta ? ' con los filtros aplicados' : ''}
                      </td>
                    </tr>
                  ) : (
                    histPageData.map((x: Debt) => (
                      <tr key={x.id} className="border-b border-line/40 hover:bg-surface-warm/20 transition-colors">
                        <td className="text-ink font-black text-xs py-4 px-6">{Utils.fmtFecha(x.fecha)}</td>
                        <td className="text-ink font-black text-xs uppercase py-4">{x.proveedor || 'SIN PROVEEDOR'}</td>
                        <td className="text-ink font-black text-xs py-4 mono">{x.numeroFactura || x.id}</td>
                        <td className="text-ink font-black text-xs text-right py-4 mono">{Utils.fmtUSD(x.montoUSD)}</td>
                        <td className="text-status-success font-black text-sm text-right py-4 mono">{Utils.fmtUSD(x.abonadoUSD || 0)}</td>
                        <td className="py-4 text-center">
                          <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full text-[10px] font-black text-ink bg-surface-soft border border-line">
                            {x.historialPagos.length}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <button
                            onClick={() => setShowDetails(x)}
                            className="inline-flex items-center gap-1.5 h-8 px-4 font-black text-[9px] uppercase bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md rounded-lg"
                          >
                            <Eye className="w-4 h-4" /> Ver Cronología
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={histSafePage} totalPages={histTotalPages} total={historialFiltrado.length} pageSize={pageSize} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* MODAL DETALLES AVANZADOS (HISTORIAL) */}
      {showDetails && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowDetails(null)}></div>
          <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter">HISTORIAL DETALLADO: {showDetails.id}</h3>
              <button onClick={() => setShowDetails(null)} className="text-white hover:text-brand-gold transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                    <label className="text-[8px] font-black uppercase text-ink block mb-1">Monto Original</label>
                    <p className="text-lg font-black text-ink">{Utils.fmtUSD(showDetails.montoUSD)}</p>
                 </div>
                 <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
                    <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Saldo Actual</label>
                    <p className="text-lg font-black text-brand-gold-deep">{fmtSaldoCxP(showDetails.saldoUSD)}</p>
                 </div>
              </div>

              {showDetails.motivo && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <label className="text-[8px] font-black uppercase text-blue-600 block mb-1">Motivo de la Deuda Directa</label>
                  <p className="text-sm font-black text-ink">{showDetails.motivo}</p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-line pb-2">
                   <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE MERCANCÍA RECIBIDA</h4>
                   <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(showDetails.fecha)}</span>
                </div>
                <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                   <table className="w-full">
                      <thead>
                        <tr className="bg-ink/5">
                           <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Cant</th>
                           <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Descripción</th>
                           <th className="text-[8px] font-black uppercase p-2 text-right text-ink">Costo Unit.</th>
                           <th className="text-[8px] font-black uppercase p-2 text-right text-ink">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showDetails.items || []).length === 0 && !showDetails.motivo && (
                          <tr><td colSpan={4} className="py-8 text-center text-ink font-black uppercase italic text-[9px]">Sin detalles de ítems registrados</td></tr>
                        )}
                        {(showDetails.items || []).length === 0 && showDetails.motivo && (
                          <tr><td colSpan={4} className="py-8 text-center text-ink font-black uppercase italic text-[9px]">Deuda directa sin ítems asociados</td></tr>
                        )}
                        {(showDetails.items || []).map((it: any, idx: number) => (
                          <tr key={idx} className="border-b border-line/20">
                             <td className="text-[9px] font-black p-2 text-ink">{it.cantidad}</td>
                             <td className="text-[9px] font-black uppercase p-2 text-ink truncate max-w-[180px]">{it.nombre || it.name}</td>
                             <td className="text-[9px] font-black p-2 text-right text-ink">{Utils.fmtUSD(it.costoUnitarioUSD || it.price)}</td>
                             <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD || (it.price * it.qty))}</td>
                          </tr>
                        ))}
                      </tbody>
                   </table>
                </div>
              </div>

              <div className="space-y-3">
                 <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS A PROVEEDOR</h4>
                 <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {(!showDetails.historialPagos || showDetails.historialPagos.length === 0) ? (
                      <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han realizado pagos a esta factura aún</div>
                    ) : (
                      showDetails.historialPagos.map((p: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center gap-2 p-3 bg-surface-soft border border-line rounded-lg group">
                           <div className="space-y-0.5 min-w-0">
                              <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)} - {p.fecha.split('T')[1]?.slice(0,5)}</p>
                              <p className="text-[8px] font-black text-ink mono">ID PAGO: {p.reciboId}</p>
                           </div>
                           <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                 <p className="text-xs font-black text-status-success">-{Utils.fmtUSD(p.montoUSD)}</p>
                                 <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
                              </div>
                              <button
                                onClick={() => handleEliminarPago(showDetails, idx)}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-white border border-status-danger/25 text-status-danger opacity-70 hover:opacity-100 hover:bg-status-danger hover:text-white transition-all shadow-sm"
                                title="Eliminar este abono y revertir deuda + asiento"
                                aria-label="Eliminar abono"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                           </div>
                        </div>
                      ))
                    )}
                 </div>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowDetails(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowPaymentModal(null)}></div>
          <div className="modal-box bg-white max-w-sm border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center text-white">
              <h3 className="text-white font-black uppercase text-xs">REGISTRAR PAGO DE DEUDA</h3>
              <button onClick={() => setShowPaymentModal(null)}><X className="w-5 h-5 text-white hover:text-brand-gold" /></button>
            </div>
            <div className="modal-body p-8 space-y-6 bg-white">
               <div className="bg-surface-soft p-8 rounded-[20px] text-center border border-line shadow-inner">
                  <p className="text-ink text-[9px] font-black uppercase tracking-[0.2em] mb-2">SALDO PENDIENTE</p>
                  <p className="text-3xl font-black text-status-danger">{fmtSaldoCxP(showPaymentModal.saldoUSD)}</p>
                  <p className="text-sm font-black text-ink mt-1 uppercase tracking-tight italic">Equiv. {Utils.fmtBS(showPaymentModal.saldoUSD * state.tasa)}</p>
               </div>
               
               <div className="form-group">
                 <label className="text-ink text-[10px] font-black uppercase block mb-1">METODO DE PAGO</label>
                 <select 
                    className="form-select h-12 text-sm font-black uppercase border-line bg-surface-soft/50 text-ink"
                    value={paymentMethod} 
                    onChange={e => setPaymentMethod(e.target.value as any)}
                  >
                    <option value="efectivo_usd">Efectivo USD</option>
                    <option value="efectivo_bs">Efectivo BS</option>
                    <option value="pagomovil">Pago Movil</option>
                    <option value="zelle">Zelle</option>
                  </select>
               </div>

               {(() => {
                 const esBS = paymentMethod === 'efectivo_bs' || paymentMethod === 'pagomovil';
                 const appliedUSD = (parseFloat(paymentAmount) || 0) > 0 ? (esBS ? (parseFloat(paymentAmount) || 0) / state.tasa : parseFloat(paymentAmount)) : 0;
                 return (
                 <>
                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1">MONTO A PAGAR ({esBS ? 'BS' : 'USD'})</label>
                    <div className="relative">
                      <input 
                        className="form-input h-12 text-xl font-black text-ink" 
                        type="number" 
                        min="0"
                        step="0.01"
                        placeholder={esBS ? '0.00' : '0.00'}
                        value={paymentAmount} 
                        onChange={e => setPaymentAmount(e.target.value)} 
                      />
                    </div>
                    {esBS && appliedUSD > 0 && (
                      <p className="text-[9px] font-black text-ink/60 mt-1 uppercase">
                        Equiv. {Utils.fmtUSD(appliedUSD)} · Tasa BCV {state.tasa.toFixed(2)}
                      </p>
                    )}
                  </div>
                  <button onClick={handleProcessPayment} disabled={isProcessing} className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl">CONFIRMAR Y ASENTAR PAGO</button>
                 </>                 );
               })()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL PAGO GLOBAL POR PROVEEDOR */}
      {globalProvider && (
        <div className="modal show"><div className="modal-bg" onClick={() => setGlobalProvider(null)}></div>
          <div className="modal-box bg-white max-w-sm border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center text-white">
              <h3 className="text-white font-black uppercase text-xs">PAGO GLOBAL A {globalProvider.proveedor}</h3>
              <button onClick={() => setGlobalProvider(null)}><X className="w-5 h-5 text-white hover:text-brand-gold" /></button>
            </div>
            <div className="modal-body p-8 space-y-6 bg-white">
               <div className="bg-surface-soft p-5 rounded-[20px] text-center border border-line shadow-inner">
                  <p className="text-ink text-[9px] font-black uppercase tracking-[0.2em] mb-2">TOTAL PENDIENTE</p>
                  <p className="text-3xl font-black text-status-danger">{Utils.fmtUSD(globalProvider.total)}</p>
                  <p className="text-base font-black text-ink mt-1">{Utils.fmtBS(globalProvider.total * (Number(state.tasa) || 0))}</p>
                  <p className="text-[9px] font-black text-ink/70 mt-0.5 uppercase">Equivalente en BS · Tasa BCV {Number(state.tasa || 0).toFixed(2)} Bs/USD</p>
                  <p className="text-[9px] font-black text-ink mt-2 uppercase tracking-tight italic">
                    Se liquidarán las deudas desde la más antigua; el excedente se aplica como abono.
                  </p>
               </div>

               <div className="p-3 rounded-lg border border-line bg-surface-soft/40">
                 <label className="flex items-center gap-2.5 cursor-pointer select-none">
                   <input
                     type="checkbox"
                     checked={pagoAtrasado}
                     onChange={e => setPagoAtrasado(e.target.checked)}
                     className="w-4 h-4 accent-brand-gold"
                   />
                   <span className="text-[10px] font-black uppercase text-ink tracking-wider">
                     Registrar Pago Atrasado
                   </span>
                 </label>
                 <p className="text-[8px] font-black text-ink/50 uppercase mt-1 ml-6 leading-snug">
                   Útil si el pago se realizó en un día anterior y no se registró en ese momento.
                 </p>

                 {pagoAtrasado && (
                   <div className="grid grid-cols-1 gap-3 mt-3 ml-6">
                     <div>
                       <label className="text-ink text-[9px] font-black uppercase block mb-1">Fecha del Pago Real</label>
                       <input
                         type="date"
                         className="form-input h-10 text-xs font-black text-ink w-full"
                         value={pagoAtrasadoFecha}
                         onChange={e => setPagoAtrasadoFecha(e.target.value)}
                       />
                     </div>
                     <div>
                       <label className="text-ink text-[9px] font-black uppercase block mb-1">Tasa BCV a Aplicar</label>
                       <input
                         type="number"
                         min="0"
                         step="0.01"
                         placeholder={state.tasa.toFixed(2)}
                         className="form-input h-10 text-xs font-black mono text-ink w-full"
                         value={pagoAtrasadoTasa}
                         onChange={e => setPagoAtrasadoTasa(e.target.value.replace(/[^0-9.]/g, ''))}
                       />
                       <p className="text-[8px] font-black text-ink/50 uppercase mt-0.5">
                         {pagoAtrasadoTasa ? `Tasa: ${parseFloat(pagoAtrasadoTasa).toFixed(2)} Bs/USD · Tasa actual: ${state.tasa.toFixed(2)}` : `Actual: ${state.tasa.toFixed(2)} · Si se deja en blanco se usa la actual`}
                       </p>
                     </div>
                   </div>
                 )}
               </div>

               <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">METODO DE PAGO</label>
                  <select
                     className="form-select h-12 text-sm font-black uppercase border-line bg-surface-soft/50 text-ink"
                     value={paymentMethod}
                     onChange={e => setPaymentMethod(e.target.value as any)}
                  >
                     <option value="efectivo_usd">Efectivo USD</option>
                     <option value="efectivo_bs">Efectivo BS</option>
                     <option value="pagomovil">Pago Movil</option>
                     <option value="zelle">Zelle</option>
                  </select>
               </div>

               {(() => {
                 const esBS = paymentMethod === 'efectivo_bs' || paymentMethod === 'pagomovil';
                 const tasaPrev = pagoAtrasado ? (parseFloat(pagoAtrasadoTasa) || state.tasa) : state.tasa;
                 const appliedUSD = (parseFloat(paymentAmount) || 0) > 0 ? (esBS ? (parseFloat(paymentAmount) || 0) / tasaPrev : parseFloat(paymentAmount)) : 0;
                 return (
                 <>
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">MONTO A PAGAR ({esBS ? 'BS' : 'USD'})</label>
                  <div className="relative">
                     <input
                        className="form-input h-12 text-xl font-black text-ink"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={paymentAmount}
                        onChange={e => setPaymentAmount(e.target.value)}
                     />
                  </div>
                  {esBS && appliedUSD > 0 && (
                    <p className="text-[9px] font-black text-ink/60 mt-1 uppercase">
                      Equiv. {Utils.fmtUSD(appliedUSD)} · Tasa {pagoAtrasado && pagoAtrasadoTasa ? `aplicada ${tasaPrev.toFixed(2)}` : `BCV ${state.tasa.toFixed(2)}`}
                    </p>
                  )}
                </div>
                <button onClick={handleProcessGlobalPayment} disabled={isProcessing} className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl">
                  LIQUIDAR DEUDAS CRONOLÓGICAMENTE
                </button>
                 </>
                 );
               })()}
            </div>
          </div>
        </div>
      )}
      {showDeudaDirectaModal && (
        <div className="modal show">
          <div className="modal-bg" onClick={() => setShowDeudaDirectaModal(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center text-white">
              <h3 className="text-white font-black uppercase text-sm flex items-center gap-2">
                <FilePlus className="w-5 h-5 text-brand-gold" /> Agregar Deuda Directa a Proveedor
              </h3>
              <button onClick={() => setShowDeudaDirectaModal(false)} className="text-white hover:text-brand-gold transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body p-6 space-y-5 bg-white max-h-[80vh] overflow-y-auto">
              {/* Buscador de Proveedor */}
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Buscar Proveedor</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                  <input 
                    className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                    placeholder="Escriba para buscar..."
                    value={proveedorSearch}
                    onChange={e => setProveedorSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Lista de Proveedores */}
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Seleccionar Proveedor</label>
                <div className="max-h-[180px] overflow-y-auto border border-line rounded-lg">
                  {proveedoresFiltrados.length === 0 ? (
                    <div className="p-4 text-center text-ink font-black uppercase italic text-[10px]">
                      No hay proveedores registrados
                    </div>
                  ) : (
                    proveedoresFiltrados.map((proveedor: string, index: number) => (
                      <button
                        key={index}
                        onClick={() => {
                          setSelectedProveedor(proveedor);
                          setProveedorSearch(proveedor);
                        }}
                        className={`w-full text-left px-4 py-3 text-xs font-black uppercase transition-colors border-b border-line/20 last:border-0 hover:bg-surface-warm/30 ${
                          selectedProveedor === proveedor 
                            ? 'bg-brand-gold/10 text-brand-gold-deep border-l-4 border-brand-gold' 
                            : 'text-ink hover:bg-surface-soft'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <User className="w-4 h-4 opacity-50" />
                          {proveedor}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selectedProveedor && (
                <>
                  <div className="bg-brand-gold/5 p-3 rounded-lg border border-brand-gold/20">
                    <p className="text-[9px] font-black uppercase text-brand-gold-deep">Proveedor Seleccionado</p>
                    <p className="text-sm font-black text-ink">{selectedProveedor}</p>
                  </div>

                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1">Fecha de la Deuda</label>
                    <input 
                      type="date" 
                      className="form-input h-11 text-sm font-black text-ink w-full" 
                      value={fechaDeuda}
                      onChange={e => setFechaDeuda(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1">Monto (USD)</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                      <input                         type="number" 
                        className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                        placeholder="0.00"
                        value={deudaMonto}
                        onChange={e => setDeudaMonto(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1">Motivo de la Deuda</label>
                    <textarea 
                      className="form-input h-20 text-sm font-black text-ink w-full resize-none" 
                      placeholder="Ej: Compra de mercancía anterior al sistema, Servicio pendiente, etc."
                      value={deudaMotivo}
                      onChange={e => setDeudaMotivo(e.target.value)}
                    />
                  </div>

                  <button 
                    onClick={handleGuardarDeudaDirecta} 
                    disabled={isProcessing}
                    className="btn btn-primary w-full h-14 font-black uppercase text-xs mt-4 shadow-xl tracking-widest"
                  >
                    <Save className="w-4 h-4 mr-2" /> Registrar Deuda Directa
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}