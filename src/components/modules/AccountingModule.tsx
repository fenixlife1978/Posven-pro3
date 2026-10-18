"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, LibroDiarioEntry, PaymentMethod } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { 
  BookOpen, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  Plus, 
  Search, 
  FileText, 
  Trash2, 
  Calendar,
  Scale,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  Eye,
  Receipt
} from 'lucide-react';
import { exportarPDFLibroDiario } from '@/lib/pdf-generator';

export default function AccountingModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  useEffect(() => { Store.ensureLoaded('libroDiario'); Store.ensureLoaded('ventas'); }, []);
  // Estados de Filtro
  const [filterType, setFilterType] = useState<'hoy' | 'ayer' | 'mes' | 'rango'>('hoy');
  const [desde, setDesde] = useState(Utils.hoy());
  const [hasta, setHasta] = useState(Utils.hoy());
  const [search, setSearch] = useState('');
  
  // Paginación
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [showModal, setShowModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LibroDiarioEntry | null>(null);
  
  const [formData, setFormData] = useState({
    concepto: '',
    montoUSD: '',
    categoria: 'NOMINA' as any,
    metodo: 'efectivo_usd' as PaymentMethod
  });

  // Lógica de cálculo de fechas basada en el tipo de filtro
  useEffect(() => {
    const hoy = Utils.hoy();
    if (filterType === 'hoy') {
      setDesde(hoy);
      setHasta(hoy);
    } else if (filterType === 'ayer') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ayer = d.toISOString().split('T')[0];
      setDesde(ayer);
      setHasta(ayer);
    } else if (filterType === 'mes') {
      const d = new Date();
      const y = d.getFullYear();
      const m = d.getMonth();
      const first = new Date(y, m, 1).toISOString().split('T')[0];
      const last = new Date(y, m + 1, 0).toISOString().split('T')[0];
      setDesde(first);
      setHasta(last);
    }
    setPage(1); // Reiniciar paginación al cambiar filtro
  }, [filterType]);

  const filteredDiario = useMemo(() => {
    return (state.libroDiario || []).filter(e => {
      if (!e.fecha) return false;
      const d = e.fecha.slice(0, 10);
      const matchesDate = d >= desde && d <= hasta;
      const matchesSearch = !search.trim() || 
                           e.concepto?.toLowerCase().includes(search.toLowerCase()) || 
                           e.categoria?.toLowerCase().includes(search.toLowerCase());
      return matchesDate && matchesSearch;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [state.libroDiario, desde, hasta, search]);

  // Totales basados en el filtro actual
  const totalIngresos = filteredDiario.filter(e => e.tipo === 'ingreso').reduce((s, e) => s + e.montoUSD, 0);
  const totalEgresos = filteredDiario.filter(e => e.tipo === 'egreso').reduce((s, e) => s + e.montoUSD, 0);
  const balanceNeto = totalIngresos - totalEgresos;

  // Datos paginados
  const totalPages = Math.ceil(filteredDiario.length / pageSize);
  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDiario.slice(start, start + pageSize);
  }, [filteredDiario, page]);

  const handleSaveExpense = () => {
    if (!formData.concepto || !formData.montoUSD) return alert('Datos incompletos');
    const mUSD = parseFloat(formData.montoUSD) || 0;
    
    const entry: LibroDiarioEntry = {
      id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
      fecha: Utils.ahora(),
      tipo: 'egreso',
      categoria: formData.categoria,
      concepto: formData.concepto.toUpperCase(),
      montoUSD: mUSD,
      montoBS: mUSD * state.tasa,
      metodo: formData.metodo,
      referencia: 'MANUAL'
    };

    updateState({ libroDiario: [entry, ...(state.libroDiario || [])] });
    setShowModal(false);
    setFormData({ concepto: '', montoUSD: '', categoria: 'NOMINA', metodo: 'efectivo_usd' });
  };

  const eliminarAsiento = (id: string) => {
    if (!confirm('¿Seguro que desea eliminar este asiento manual?')) return;
    updateState({ libroDiario: (state.libroDiario || []).filter(e => e.id !== id) });
  };

  const handleExport = () => {
    exportarPDFLibroDiario(filteredDiario, state.empresa, { totalIngresos, totalEgresos, balanceNeto });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <BookOpen className="text-brand-gold w-7 h-7" /> LIBRO DIARIO DE CONTABILIDAD
          </h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Control de Flujo de Efectivo Real</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={handleExport} className="flex-1 sm:flex-none btn btn-secondary h-11 px-6 font-black uppercase text-xs flex items-center justify-center gap-2 shadow-md">
            <FileText className="w-4 h-4" /> Exportar PDF
          </button>
          <button onClick={() => setShowModal(true)} className="flex-1 sm:flex-none btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center justify-center gap-2 shadow-lg">
            <Plus className="w-4 h-4" /> Nuevo Gasto
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="kpi bg-white border-line p-6 rounded-2xl shadow-sm border-l-[6px] border-l-status-success">
          <div className="text-ink text-[10px] font-black uppercase mb-1 opacity-60 flex justify-between">
            Ingresos Periodo <ArrowUpCircle className="w-3.5 h-3.5 text-status-success" />
          </div>
          <div className="text-2xl font-black text-status-success">{Utils.fmtUSD(totalIngresos)}</div>
        </div>
        <div className="kpi bg-white border-line p-6 rounded-2xl shadow-sm border-l-[6px] border-l-status-danger">
          <div className="text-ink text-[10px] font-black uppercase mb-1 opacity-60 flex justify-between">
            Egresos Periodo <ArrowDownCircle className="w-3.5 h-3.5 text-status-danger" />
          </div>
          <div className="text-2xl font-black text-status-danger">{Utils.fmtUSD(totalEgresos)}</div>
        </div>
        <div className="kpi bg-ink text-white p-6 rounded-2xl shadow-xl border-l-[6px] border-l-brand-gold">
          <div className="text-white/40 text-[10px] font-black uppercase mb-1">Balance Neto</div>
          <div className={`text-2xl font-black ${balanceNeto >= 0 ? 'text-brand-gold' : 'text-status-danger'}`}>
            {Utils.fmtUSD(balanceNeto)}
          </div>
        </div>
      </div>

      <div className="card bg-white border-line p-5 flex flex-wrap gap-4 items-end shadow-sm no-print">
         <div className="form-group mb-0">
            <label className="text-[9px] font-black text-ink/40 uppercase block mb-1">Periodo de Consulta</label>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-brand-gold mr-1" />
              <select 
                className="form-select h-10 text-xs font-black uppercase bg-surface-soft border-line rounded-lg w-40"
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
              >
                <option value="hoy">Hoy</option>
                <option value="ayer">Ayer</option>
                <option value="mes">Mes Actual</option>
                <option value="rango">Rango Personalizado</option>
              </select>
            </div>
         </div>

         {filterType === 'rango' && (
           <div className="flex gap-2 animate-in slide-in-from-left-2">
             <div className="form-group mb-0">
                <label className="text-[9px] font-black text-ink/40 uppercase block mb-1">Desde</label>
                <input type="date" className="form-input h-10 text-xs font-bold w-36" value={desde} onChange={e => setDesde(e.target.value)} />
             </div>
             <div className="form-group mb-0">
                <label className="text-[9px] font-black text-ink/40 uppercase block mb-1">Hasta</label>
                <input type="date" className="form-input h-10 text-xs font-bold w-36" value={hasta} onChange={e => setHasta(e.target.value)} />
             </div>
           </div>
         )}

         <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-ink/30" />
            <input className="form-input pl-10 h-10 text-xs font-bold uppercase" placeholder="Buscar por concepto..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
         </div>
      </div>

      <div className="card bg-white border-line shadow-lg overflow-hidden rounded-xl">
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="bg-ink text-white">
                <th className="text-[10px] font-black uppercase py-4 px-6 text-left">Fecha</th>
                <th className="text-[10px] font-black uppercase py-4 text-left">Concepto / Categoría</th>
                <th className="text-[10px] font-black uppercase py-4 text-left">Método</th>
                <th className="text-[10px] font-black uppercase py-4 text-right">Ingreso</th>
                <th className="text-[10px] font-black uppercase py-4 text-right">Egreso</th>
                <th className="text-[10px] font-black uppercase py-4 px-6 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {paginatedData.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-24 text-ink/20 font-black italic uppercase">Sin movimientos en este periodo</td></tr>
              ) : (
                paginatedData.map(e => (
                  <tr key={e.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                    <td className="py-4 px-6 text-[11px] font-bold text-ink">
                      {Utils.fmtFecha(e.fecha)} <span className="opacity-40">{e.fecha.includes('T') ? e.fecha.split('T')[1].slice(0, 5) : ''}</span>
                    </td>
                    <td className="py-4">
                       <div className="text-ink font-black text-xs uppercase truncate max-w-[200px]">{e.concepto}</div>
                       <div className="text-ink/50 text-[9px] font-bold uppercase tracking-widest">{e.categoria}</div>
                    </td>
                    <td className="py-4">
                      <span className="badge badge-neutral text-[9px] font-black uppercase">{Utils.metodoLabel(e.metodo)}</span>
                    </td>
                    <td className="py-4 text-right">
                      {e.tipo === 'ingreso' ? <span className="font-black text-status-success">{Utils.fmtUSD(e.montoUSD)}</span> : '-'}
                    </td>
                    <td className="py-4 text-right">
                      {e.tipo === 'egreso' ? <span className="font-black text-status-danger">-{Utils.fmtUSD(e.montoUSD)}</span> : '-'}
                    </td>
                    <td className="py-4 px-6 text-center">
                       <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setSelectedEntry(e)} className="text-status-info hover:text-blue-700 transition-colors p-2" title="Ver Detalle Auditoría">
                            <Eye className="w-4 h-4" />
                          </button>
                          {e.referencia === 'MANUAL' && (
                            <button onClick={() => eliminarAsiento(e.id)} className="text-ink/20 hover:text-status-danger transition-colors p-2" title="Eliminar Asiento Manual">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* CONTROLES DE PAGINACIÓN */}
        {totalPages > 1 && (
          <div className="p-4 bg-surface-soft border-t border-line flex items-center justify-between">
            <div className="text-[10px] font-black uppercase text-ink/40">
              Página {page} de {totalPages} | Total {filteredDiario.length} Movimientos
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))} 
                disabled={page === 1}
                className="w-10 h-10 rounded-full border border-line bg-white flex items-center justify-center text-ink disabled:opacity-20 hover:border-brand-gold transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                disabled={page === totalPages}
                className="w-10 h-10 rounded-full border border-line bg-white flex items-center justify-center text-ink disabled:opacity-20 hover:border-brand-gold transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL DETALLE DE MOVIMIENTO */}
      {selectedEntry && (
        <div className="modal show" style={{ zIndex: 110 }}><div className="modal-bg" onClick={() => setSelectedEntry(null)}></div>
          <div className="modal-box bg-white max-w-xl border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase italic tracking-widest flex items-center gap-2">
                <Eye className="w-4 h-4 text-brand-gold" /> AUDITORÍA DE MOVIMIENTO: {selectedEntry.id}
              </h3>
              <button onClick={() => setSelectedEntry(null)}><X className="text-white/40 hover:text-white" /></button>
            </div>
            <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                   <label className="text-[8px] font-black uppercase text-ink/40 block mb-1">Categoría / Origen</label>
                   <p className="text-xs font-black text-ink uppercase">{selectedEntry.categoria.replace('_', ' ')}</p>
                 </div>
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                   <label className="text-[8px] font-black uppercase text-ink/40 block mb-1">Fecha / Hora Registro</label>
                   <p className="text-xs font-black text-ink">{Utils.fmtFecha(selectedEntry.fecha)} {selectedEntry.fecha.includes('T') ? selectedEntry.fecha.split('T')[1].slice(0, 5) : ''}</p>
                 </div>
              </div>

              <div className="p-4 bg-brand-gold-soft/20 border border-brand-gold/20 rounded-xl">
                 <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Concepto Detallado</label>
                 <p className="text-sm font-black text-ink uppercase italic leading-relaxed">{selectedEntry.concepto}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="p-4 bg-ink text-white rounded-xl text-center">
                    <label className="text-[8px] font-black uppercase opacity-40 block mb-1">Monto en Divisas</label>
                    <p className="text-2xl font-black text-brand-gold">{Utils.fmtUSD(selectedEntry.montoUSD)}</p>
                 </div>
                 <div className="p-4 bg-surface-soft border border-line rounded-xl text-center">
                    <label className="text-[8px] font-black uppercase text-ink/40 block mb-1">Equivalente Bolívares</label>
                    <p className="text-2xl font-black text-ink">{Utils.fmtBS(selectedEntry.montoBS)}</p>
                 </div>
              </div>

              {/* Lógica de desglose de items */}
              {(() => {
                const ref = selectedEntry.referencia;
                if (ref === 'MANUAL') return null;

                const cleanRef = ref.split('-')[0];
                const sale = state.ventas.find(v => v.id === cleanRef);
                const cxp = state.cxp.find(c => c.id === ref || c.numeroFactura === ref);
                const dev = state.devoluciones.find(d => d.id === ref);
                const anu = state.anulaciones.find(a => a.id === ref);

                let items: any[] = [];
                if (sale) items = sale.items;
                else if (cxp) items = cxp.items || [];
                else if (dev) items = dev.items;
                else if (anu) items = anu.items || [];

                if (items.length === 0) return (
                  <div className="py-8 text-center border-t border-line/20">
                    <p className="text-[10px] font-black uppercase text-ink/20 italic tracking-widest">Sin desglose de ítems disponible para esta referencia ({ref})</p>
                  </div>
                );

                return (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2 flex items-center gap-2">
                      <Receipt className="w-3 h-3" /> DESGLOSE DE PRODUCTOS
                    </h4>
                    <div className="bg-surface-soft/50 rounded-xl overflow-hidden border border-line/30 shadow-inner">
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
                          {items.map((it: any, idx: number) => (
                            <tr key={idx} className="border-b border-line/20 hover:bg-white/40">
                              <td className="text-[10px] font-black p-2 text-ink">{it.cantidad || it.qty}</td>
                              <td className="text-[10px] font-black uppercase p-2 truncate max-w-[220px] text-ink">{it.nombre || it.name}</td>
                              <td className="text-[10px] font-black p-2 text-right text-ink">{Utils.fmtUSD(it.precioUnitUSD || it.costoUnitarioUSD || it.price || 0)}</td>
                              <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD || ((it.price || 0) * (it.qty || 0)))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-foot p-5 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setSelectedEntry(null)} className="btn btn-primary px-10 font-black uppercase text-[10px] rounded-lg shadow-lg tracking-widest">Cerrar Auditoría</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GASTO MANUAL */}
      {showModal && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowModal(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center">
              <h3 className="text-white font-black uppercase text-xs tracking-widest flex items-center gap-2">
                <ArrowDownCircle className="w-4 h-4 text-status-danger" /> Registrar Egreso de Caja
              </h3>
              <button onClick={() => setShowModal(false)}><X className="text-white/40 hover:text-white" /></button>
            </div>
            <div className="modal-body p-8 space-y-6">
               <div className="form-group">
                 <label className="text-ink text-[10px] font-black uppercase block mb-1 opacity-60">Categoría del Gasto</label>
                 <select className="form-select h-11 text-xs font-black uppercase border-line" value={formData.categoria} onChange={e => setFormData({...formData, categoria: e.target.value})}>
                   <option value="NOMINA">Nómina (Sueldos y Salarios)</option>
                   <option value="SERVICIOS">Servicios Básicos (Luz, Agua, Internet)</option>
                   <option value="IMPUESTOS">Impuestos / Tasas Municipales</option>
                   <option value="OTROS_GASTOS">Gastos Administrativos / Otros</option>
                 </select>
               </div>
               <div className="form-group">
                 <label className="text-ink text-[10px] font-black uppercase block mb-1 opacity-60">Concepto Detallado</label>
                 <input className="form-input h-11 text-xs font-black uppercase" value={formData.concepto} onChange={e => setFormData({...formData, concepto: e.target.value})} placeholder="EJ: PAGO SEMANA JUNIO - JUAN PEREZ" />
               </div>
               <div className="grid grid-cols-2 gap-5">
                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1 opacity-60">Monto ($)</label>
                    <input className="form-input h-11 text-lg font-black text-status-danger" type="number" value={formData.montoUSD} onChange={e => setFormData({...formData, montoUSD: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1 opacity-60">Método Pago</label>
                    <select className="form-select h-11 text-[10px] font-black uppercase" value={formData.metodo} onChange={e => setFormData({...formData, metodo: e.target.value as any})}>
                      <option value="efectivo_usd">Efectivo USD</option>
                      <option value="efectivo_bs">Efectivo BS</option>
                      <option value="pagomovil">Pago Movil</option>
                      <option value="zelle">Zelle</option>
                    </select>
                  </div>
               </div>
               <button onClick={handleSaveExpense} className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl tracking-widest">Confirmar Gasto y Asentar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}