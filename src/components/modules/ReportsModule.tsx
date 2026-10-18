"use client";

import React, { useState, useEffect } from 'react';
import { AppState } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { FileText, TrendingUp, Calendar, Printer, ArrowLeft, Monitor } from 'lucide-react';
import { exportarPDFVentasDetallado } from '@/lib/pdf-generator';
import ZReportPreview80mm from '@/components/pos/ZReportPreview80mm';

export default function ReportsModule({ state }: { state: AppState }) {
  useEffect(() => {
    // El listener realtime mantiene solo los últimos 100 cortes; al abrir Reportes
    // se recupera el histórico completo para filtros y exportaciones.
    Store.ensureLoaded('ventas');
    Store.ensureLoaded('reportesZ');
    Store.ensureLoaded('devoluciones');
    Store.ensureLoaded('anulaciones');
  }, []);
  const [tab, setTab] = useState('ventas');
  const [desde, setDesde] = useState(Utils.hoy());
  const [hasta, setHasta] = useState(Utils.hoy());
  const [terminalFilter, setTerminalFilter] = useState('all');
  const [reprintZ, setReprintZ] = useState<any | null>(null);
  
  useEffect(() => {
    // Reportes es histórico y puede abarcar meses. Cargar únicamente el rango
    // solicitado evita descargar colecciones completas al entrar al módulo.
    void Promise.all([
      Store.ensureReportRange('ventas', desde, hasta, terminalFilter),
      Store.ensureReportRange('reportesZ', desde, hasta, terminalFilter),
    ]).catch(e => console.error('Error cargando rango de reportes:', e));
  }, [desde, hasta, terminalFilter]);

  // Filtrado de Ventas por Fecha y Terminal
  const ventasFiltradas = (state.ventas || []).filter(v => {
    const fechaVenta = v.fecha ? v.fecha.split('T')[0] : '';
    const matchesFecha = fechaVenta >= desde && fechaVenta <= hasta;
    const matchesTerminal = terminalFilter === 'all' ? true : v.terminalId === terminalFilter;
    return matchesFecha && matchesTerminal;
  });

  const totalVentasUSD = ventasFiltradas.reduce((s, v) => s + v.totalUSD, 0);

  // En el historial se conserva la moneda original del pago. Para pagos
  // originados en BS mostramos su equivalencia BS; para USD (Zelle/Efectivo
  // USD) la columna BS queda neutra porque no corresponde a una conversión.
  const metodosBS = new Set(['efectivo_bs', 'punto_venta', 'biopago', 'pagomovil', 'transferencia']);
  const metodosUSD = new Set(['efectivo_usd', 'zelle']);
  const getEquivalenciaBS = (v: any): number | null => {
    const pagos = Array.isArray(v.payments) ? v.payments : [];
    if (pagos.length > 0) {
      const pagosBS = pagos.filter((p: any) => metodosBS.has(String(p?.metodo)));
      if (pagosBS.length > 0) {
        return pagosBS.reduce((s: number, p: any) => s + (Number(p?.montoBS) || 0), 0);
      }
      if (pagos.every((p: any) => metodosUSD.has(String(p?.metodo)))) return null;
    }
    if (metodosBS.has(String(v.metodoPago))) return Number(v.totalBS) || 0;
    if (metodosUSD.has(String(v.metodoPago))) return null;
    return Number(v.totalBS) > 0 ? Number(v.totalBS) : null;
  };
  
  // Rentabilidad
  const totalCostoVentas = ventasFiltradas.reduce((s, v) => {
    return s + v.items.reduce((si, item) => {
      const p = state.productos.find(x => x.id === item.productoId);
      return si + (p ? p.costoUSD * item.cantidad : 0);
    }, 0);
  }, 0);
  const gananciaNeta = totalVentasUSD - totalCostoVentas;

  const reportesZFiltrados = (state.reportesZ || [])
    .filter(z => {
      const fechaZ = z.fecha ? z.fecha.split('T')[0] : '';
      const matchesFecha = fechaZ >= desde && fechaZ <= hasta;
      const matchesTerminal = terminalFilter === 'all' ? true : z.terminalId === terminalFilter;
      return matchesFecha && matchesTerminal;
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  const handleExportPDF = () => {
    const totalVendidos = ventasFiltradas.reduce((acc, v) => acc + v.items.reduce((sum, item) => sum + item.cantidad, 0), 0);
    exportarPDFVentasDetallado(
      ventasFiltradas, 
      state.empresa, 
      `Desde ${Utils.fmtFecha(desde)} Hasta ${Utils.fmtFecha(hasta)}`, 
      { totalVendidos }
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Navegación de Reportes */}
      <div className="tabs flex border-b border-line mb-6 overflow-x-auto no-print">
        <button 
          onClick={() => setTab('ventas')} 
          className={`px-6 py-3 text-sm font-black uppercase tracking-widest border-b-2 transition-all ${tab === 'ventas' ? 'border-brand-gold text-brand-gold' : 'border-transparent text-ink hover:text-brand-gold'}`}
        >
          <div className="flex items-center gap-2"><FileText className="w-4 h-4"/> Reporte de Ventas</div>
        </button>
        <button 
          onClick={() => setTab('rentabilidad')} 
          className={`px-6 py-3 text-sm font-black uppercase tracking-widest border-b-2 transition-all ${tab === 'rentabilidad' ? 'border-brand-gold text-brand-gold' : 'border-transparent text-ink hover:text-brand-gold'}`}
        >
          <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Análisis de Rentabilidad</div>
        </button>
        <button onClick={() => setTab('z')} className="px-6 py-3 text-sm font-black uppercase tracking-widest border-b-2 border-transparent text-ink hover:text-brand-gold">
          <div className="flex items-center gap-2"><Monitor className="w-4 h-4"/> Historial de Cortes Z</div>
        </button>
      </div>

      {/* Contenido Ventas */}
      {tab === 'ventas' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Filtros */}
          <div className="card p-5 bg-white border-line flex flex-wrap gap-6 items-end shadow-sm">
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Terminal / Punto</label>
              <div className="relative">
                <Monitor className="absolute left-3 top-2.5 w-4 h-4 text-brand-gold opacity-50" />
                <select 
                  className="form-select pl-10 h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg"
                  value={terminalFilter}
                  onChange={e => setTerminalFilter(e.target.value)}
                >
                  <option value="all">TODOS LOS TERMINALES (GLOBAL)</option>
                  {state.terminales?.map(t => (
                    <option key={t.id} value={t.id}>{t.nombre.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Fecha Inicial (Desde)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-brand-gold opacity-50" />
                <input 
                  type="date" 
                  className="form-input pl-10 h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg" 
                  value={desde} 
                  onChange={e => setDesde(e.target.value)} 
                />
              </div>
            </div>
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Fecha Final (Hasta)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-brand-gold opacity-50" />
                <input 
                  type="date" 
                  className="form-input pl-10 h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg" 
                  value={hasta} 
                  onChange={e => setHasta(e.target.value)} 
                />
              </div>
            </div>
            <div className="flex-1 flex justify-end gap-2">
              <button 
                className="btn btn-secondary h-10 px-6 border-line text-ink font-black uppercase text-[10px] tracking-widest flex items-center gap-2 hover:bg-surface-soft" 
                onClick={handleExportPDF}
              >
                <FileText className="w-4 h-4" /> Exportar PDF
              </button>
              <button 
                className="btn btn-secondary h-10 px-6 border-line text-ink font-black uppercase text-[10px] tracking-widest flex items-center gap-2 hover:bg-surface-soft" 
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" /> Imprimir Vista
              </button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
             <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-brand-gold">
               <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Total Ventas en Periodo (USD)</div>
               <div className="text-4xl font-black text-brand-gold-deep">{Utils.fmtUSD(totalVentasUSD)}</div>
               <div className="text-ink font-bold text-sm mt-1.5 opacity-80">{Utils.fmtBS(totalVentasUSD * state.tasa)}</div>
             </div>
             <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-status-info">
               <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Operaciones Registradas</div>
               <div className="text-4xl font-black text-ink">{ventasFiltradas.length}</div>
               <div className="text-status-info text-[10px] font-black mt-1.5 uppercase tracking-widest">Transacciones Procesadas</div>
             </div>
          </div>

          {/* Tabla */}
          <div className="card bg-white border-line shadow-md overflow-hidden rounded-xl">
            <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <FileText className="w-5 h-5 text-brand-gold" /> LISTADO DETALLADO DE FACTURACIÓN
              </h3>
            </div>
            <div className="table-wrap">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line">Fecha</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Terminal</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Cliente</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 border-b border-line">Método Pago</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 text-right border-b border-line">Monto (USD)</th>
                    <th className="text-ink font-black text-[10px] uppercase py-4 px-6 text-right border-b border-line">Monto (BS)</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasFiltradas.map(v => (
                    <tr key={v.id} className="border-b border-line/40 hover:bg-surface-warm/20 transition-colors">
                      <td className="text-ink font-bold text-xs py-4 px-6">{Utils.fmtFecha(v.fecha)}</td>
                      <td className="text-ink font-black text-[10px] uppercase py-4">{state.terminales?.find(t => t.id === v.terminalId)?.nombre || 'S/T'}</td>
                      <td className="text-ink font-black text-xs uppercase py-4">{v.cliente}</td>
                      <td className="py-4">
                        <span className="badge badge-neutral text-ink font-black text-[9px] uppercase px-2.5 py-1">
                          {Utils.metodoLabel(v.metodoPago)}
                        </span>
                      </td>
                      <td className="text-brand-gold-deep font-black text-sm text-right py-4">{Utils.fmtUSD(v.totalUSD)}</td>
                      <td className="text-ink font-bold text-xs text-right py-4 px-6">{(() => { const bs = getEquivalenciaBS(v); return bs === null ? '—' : Utils.fmtBS(bs); })()}</td>
                    </tr>
                  ))}
                  {ventasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-24 text-ink/20 font-black uppercase italic tracking-widest">
                        No se encontraron ventas para este periodo seleccionado
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Historial de Cortes Z por caja */}
      {tab === 'z' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="card p-5 bg-white border-line flex flex-wrap gap-6 items-end shadow-sm">
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Caja / Terminal</label>
              <div className="relative">
                <Monitor className="absolute left-3 top-2.5 w-4 h-4 text-brand-gold opacity-50" />
                <select className="form-select pl-10 h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg" value={terminalFilter} onChange={e => setTerminalFilter(e.target.value)}>
                  <option value="all">TODAS LAS CAJAS (GLOBAL)</option>
                  {state.terminales?.map(t => <option key={t.id} value={t.id}>{t.nombre.toUpperCase()} · {t.prefijoCaja || ''}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Desde</label>
              <input type="date" className="form-input h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg" value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div className="form-group mb-0">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Hasta</label>
              <input type="date" className="form-input h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg" value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-brand-gold"><div className="text-ink text-[10px] font-black uppercase mb-2">Cortes Z encontrados</div><div className="text-4xl font-black text-brand-gold-deep">{reportesZFiltrados.length}</div></div>
            <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-status-info"><div className="text-ink text-[10px] font-black uppercase mb-2">Ventas netas acumuladas</div><div className="text-3xl font-black text-ink">{Utils.fmtUSD(reportesZFiltrados.reduce((s,z) => s + (z.ventaNetaUSD || 0), 0))}</div></div>
            <div className="kpi bg-white border-line p-7 rounded-2xl shadow-sm border-l-[6px] border-l-status-success"><div className="text-ink text-[10px] font-black uppercase mb-2">Cajas representadas</div><div className="text-4xl font-black text-ink">{new Set(reportesZFiltrados.map(z => z.terminalId).filter(Boolean)).size}</div></div>
          </div>

          <div className="card bg-white border-line shadow-md overflow-hidden rounded-xl">
            <div className="card-head px-6 py-4 bg-ink border-b border-white/10"><h3 className="text-white font-black text-xs uppercase italic tracking-tighter">HISTORIAL SEPARADO DE CORTES Z</h3></div>
            <div className="table-wrap">
              <table className="w-full">
                <thead><tr className="bg-surface-soft">
                  <th className="text-ink font-black text-[10px] uppercase py-4 px-6">Corte Z</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4">Caja</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4">Fecha</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4 text-right">Ventas netas</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4 text-right">Facturas</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4 px-6 text-right">Anulaciones</th>
                  <th className="text-ink font-black text-[10px] uppercase py-4 text-center">Acción</th>
                </tr></thead>
                <tbody>
                  {reportesZFiltrados.map(z => (
                    <tr key={z.id} className="border-b border-line/40 hover:bg-surface-warm/20">
                      <td className="text-ink font-black text-xs mono py-4 px-6">{z.id}</td>
                      <td className="text-ink font-black text-xs uppercase py-4">{z.terminalName || 'S/T'} {z.terminalId ? '· ' + (state.terminales?.find(t => t.id === z.terminalId)?.prefijoCaja || '') : ''}</td>
                      <td className="text-ink font-bold text-xs py-4">{Utils.fmtFecha(z.fecha)}</td>
                      <td className="text-brand-gold-deep font-black text-sm text-right py-4">{Utils.fmtUSD(z.ventaNetaUSD || 0)}</td>
                      <td className="text-ink font-black text-xs text-right py-4">{z.stats?.facturas || 0}</td>
                      <td className="text-ink font-black text-xs text-right py-4 px-6">{z.stats?.anulaciones || 0}</td>
                      <td className="py-4 text-center">
                        <button
                          type="button"
                          onClick={() => setReprintZ({ ...z, empresa: state.empresa })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-ink hover:bg-surface-soft transition-colors"
                          title="Reimprimir Corte Z en 80 mm"
                        >
                          <Printer className="w-3.5 h-3.5" /> Reimprimir Corte Z
                        </button>
                      </td>
                    </tr>
                  ))}
                  {reportesZFiltrados.length === 0 && <tr><td colSpan={7} className="text-center py-24 text-ink/20 font-black uppercase italic tracking-widest">No hay cortes Z para los filtros seleccionados</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Contenido Rentabilidad */}
      {tab === 'rentabilidad' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="card bg-white border-line shadow-md overflow-hidden rounded-xl">
             <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center">
                <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-brand-gold" /> ANÁLISIS DE RENTABILIDAD DEL PERIODO
                </h3>
             </div>
             <div className="card-body p-7">
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                 <div className="kpi bg-surface-soft border-line p-6 rounded-2xl shadow-inner border-t-4 border-t-ink text-center">
                   <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Ingreso Bruto (Ventas)</div>
                   <div className="text-3xl font-black text-ink">{Utils.fmtUSD(totalVentasUSD)}</div>
                 </div>
                 <div className="kpi bg-surface-soft border-line p-6 rounded-2xl shadow-inner border-t-4 border-t-status-danger text-center">
                   <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Costo de Inversión (CPP)</div>
                   <div className="text-3xl font-black text-status-danger">{Utils.fmtUSD(totalCostoVentas)}</div>
                 </div>
                 <div className="kpi bg-surface-soft border-line p-6 rounded-2xl shadow-inner border-t-4 border-t-status-success text-center">
                   <div className="text-ink text-[10px] font-black uppercase mb-2 tracking-wider">Margen de Ganancia Neta</div>
                   <div className="text-4xl font-black text-status-success">{Utils.fmtUSD(gananciaNeta)}</div>
                   <div className="text-ink text-[11px] font-black mt-2 uppercase opacity-60">
                     Margen Real: {totalVentasUSD > 0 ? ((gananciaNeta/totalVentasUSD)*100).toFixed(2) : 0}%
                   </div>
                 </div>
               </div>
             </div>
          </div>
          
          <div className="card bg-brand-gold-soft border border-brand-gold/30 p-10 text-center rounded-2xl">
            <TrendingUp className="w-12 h-12 text-brand-gold mx-auto mb-4 opacity-50" />
            <p className="text-brand-gold-deep font-black uppercase tracking-widest text-xs leading-relaxed max-w-2xl mx-auto">
              La rentabilidad se calcula comparando el precio de venta final contra el Costo Promedio Ponderado (CPP) de cada producto al momento de la transacción.
            </p>
          </div>
        </div>
      )}
      {reprintZ && (
        <ZReportPreview80mm
          data={{ ...reprintZ, empresa: state.empresa }}
          onClose={() => setReprintZ(null)}
        />
      )}
    </div>
  );
}
