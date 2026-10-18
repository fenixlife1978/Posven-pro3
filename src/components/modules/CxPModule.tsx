'use client';

import React, { useState } from 'react';
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
  Save
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { exportarPDFCxP } from '@/lib/pdf-generator';
import { Pagination } from '@/components/ui/pagination';

interface CxPModuleProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

export default function CxPModule({ state, updateState }: CxPModuleProps) {
  const [showDetails, setShowDetails] = useState<any>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo_usd');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const cxpList = state.cxp || [];
  const cxpTotalPages = Math.max(1, Math.ceil(cxpList.length / pageSize));
  const cxpSafePage = Math.min(page, cxpTotalPages);
  const cxpPageData = cxpList.slice((cxpSafePage - 1) * pageSize, cxpSafePage * pageSize);
  
  // Estado para el modal de Deuda Directa
  const [showDeudaDirectaModal, setShowDeudaDirectaModal] = useState(false);
  const [proveedorSearch, setProveedorSearch] = useState('');
  const [selectedProveedor, setSelectedProveedor] = useState('');
  const [deudaMonto, setDeudaMonto] = useState('');
  const [deudaMotivo, setDeudaMotivo] = useState('');
  const [fechaDeuda, setFechaDeuda] = useState(Utils.hoy());

  const pendientes = (state.cxp || []).filter((x: Debt) => x.estado !== 'pagada');
  const totalPendiente = pendientes.reduce((s: number, x: Debt) => s + x.saldoUSD, 0);

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
    setPaymentAmount(debt.saldoUSD.toString());
    setPaymentMethod('efectivo_usd');
  };

  const handleProcessPayment = () => {
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El monto debe ser mayor a cero."
      });
      return;
    }

    if (amount > (showPaymentModal.saldoUSD + 0.001)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El monto no puede ser mayor al saldo pendiente."
      });
      return;
    }

    const ahoraStr = Utils.ahora();
    
    // 1. Actualizar CxP
    const nuevasCxP = state.cxp.map((c: Debt) => {
      if (c.id === showPaymentModal.id) {
        const nuevoSaldo = Math.max(0, c.saldoUSD - amount);
        const historialPagos = c.historialPagos || [];
        return {
          ...c,
          abonadoUSD: c.abonadoUSD + amount,
          saldoUSD: nuevoSaldo,
          estado: nuevoSaldo <= 0.001 ? 'pagada' : 'parcial',
          historialPagos: [...historialPagos, {
            fecha: ahoraStr,
            montoUSD: amount,
            montoBS: amount * state.tasa,
            metodo: paymentMethod,
            reciboId: `PAY-${Store.uid().toUpperCase().slice(0, 4)}`
          }]
        };
      }
      return c;
    });

    // 2. Crear Asiento Contable (Egreso)
    const nuevoAsiento: LibroDiarioEntry = {
      id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
      fecha: ahoraStr,
      tipo: 'egreso',
      categoria: 'PAGO_PROVEEDOR' as any,
      concepto: `PAGO DEUDA A: ${showPaymentModal.proveedor.toUpperCase()} - REF FACT: ${showPaymentModal.numeroFactura || 'S/N'}`,
      montoUSD: amount,
      montoBS: amount * state.tasa,
      metodo: paymentMethod,
      referencia: showPaymentModal.id
    };

    updateState({ 
      cxp: nuevasCxP as Debt[], 
      libroDiario: [nuevoAsiento, ...(state.libroDiario || [])] 
    });

    toast({
      title: "Pago registrado",
      description: `Se ha registrado el pago de ${Utils.fmtUSD(amount)}`
    });
    
    setShowPaymentModal(null);
    setPaymentAmount('');
  };

  const handleGuardarDeudaDirecta = () => {
    if (!selectedProveedor) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debe seleccionar un proveedor."
      });
      return;
    }

    const monto = parseFloat(deudaMonto) || 0;
    if (monto <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El monto debe ser mayor a cero."
      });
      return;
    }

    if (!deudaMotivo.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debe ingresar un motivo para la deuda."
      });
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

    const nuevasCxP = [...(state.cxp || []), nuevaDeuda];

    // Crear asiento contable por la deuda
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

    updateState({ 
      cxp: nuevasCxP as Debt[],
      libroDiario: [nuevoAsiento, ...(state.libroDiario || [])]
    });

    toast({
      title: "Deuda registrada",
      description: `Se ha registrado la deuda de ${Utils.fmtUSD(monto)} a ${selectedProveedor}`
    });

    // Resetear formulario
    setShowDeudaDirectaModal(false);
    setSelectedProveedor('');
    setDeudaMonto('');
    setDeudaMotivo('');
    setProveedorSearch('');
    setFechaDeuda(Utils.hoy());
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
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <Calculator className="w-5 h-5 text-brand-gold" /> CUENTAS POR PAGAR ACTIVAS
          </h3>
        </div>
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-soft">
                <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line">Fecha</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Venc.</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Proveedor</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Factura</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 text-right border-b border-line">Monto USD</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 text-right border-b border-line">Saldo</th>
                <th className="text-ink font-black text-[10px] uppercase px-6 text-center border-b border-line">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {state.cxp.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-24 text-ink font-black uppercase italic tracking-widest">
                    No se registran cuentas por pagar actualmente
                  </td>
                </tr>
              ) : (
                cxpPageData.map((x: Debt) => (
                  <tr key={x.id} className="border-b border-line/40 hover:bg-surface-warm/20 transition-colors">
                    <td className="text-ink font-black text-xs py-4 px-6">{Utils.fmtFecha(x.fecha)}</td>
                    <td className={`text-xs font-black py-4 ${x.fechaVencimiento < Utils.hoy() && x.estado !== 'pagada' ? 'text-status-danger' : 'text-ink'}`}>
                      {Utils.fmtFecha(x.fechaVencimiento)}
                    </td>
                    <td className="text-ink font-black text-xs uppercase py-4">{x.proveedor}</td>
                    <td className="text-ink font-black text-xs py-4 mono">{x.numeroFactura || '-'}</td>
                    <td className="text-ink font-black text-xs text-right py-4 mono">{Utils.fmtUSD(x.montoUSD)}</td>
                    <td className="text-brand-gold-deep font-black text-sm text-right py-4 mono">{Utils.fmtUSD(x.saldoUSD)}</td>
                    <td className="py-4 px-6 text-center">
                       <div className="flex justify-center items-center gap-3">
                          <button 
                            onClick={() => setShowDetails(x)} 
                            className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"
                            title="Ver Historial Detallado"
                          >
                            <Eye className="w-5 h-5"/>
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
        <Pagination page={cxpSafePage} totalPages={cxpTotalPages} total={cxpList.length} pageSize={pageSize} onPageChange={setPage} />
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
                    <p className="text-lg font-black text-brand-gold-deep">{Utils.fmtUSD(showDetails.saldoUSD)}</p>
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
                        <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                           <div className="space-y-0.5">
                              <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)} - {p.fecha.split('T')[1]?.slice(0,5)}</p>
                              <p className="text-[8px] font-black text-ink mono">ID PAGO: {p.reciboId}</p>
                           </div>
                           <div className="text-right">
                              <p className="text-xs font-black text-status-success">-{Utils.fmtUSD(p.montoUSD)}</p>
                              <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
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
                  <p className="text-3xl font-black text-status-danger">{Utils.fmtUSD(showPaymentModal.saldoUSD)}</p>
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

               <div className="form-group">
                 <label className="text-ink text-[10px] font-black uppercase block mb-1">MONTO A PAGAR (USD)</label>
                 <div className="relative">
                   <input 
                     className="form-input h-12 text-xl font-black text-ink" 
                     type="number" 
                     value={paymentAmount} 
                     onChange={e => setPaymentAmount(e.target.value)} 
                   />
                 </div>
               </div>
               <button onClick={handleProcessPayment} className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl">CONFIRMAR Y ASENTAR PAGO</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DEUDA DIRECTA A PROVEEDOR */}
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
                      <input 
                        type="number" 
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