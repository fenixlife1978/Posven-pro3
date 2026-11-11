"use client";

import React, { useMemo, useState } from 'react';
import { AppState, Sale } from '@/lib/types';
import { FileSpreadsheet, Search, Download, CalendarDays, AlertTriangle, ReceiptText, Percent, CircleDollarSign } from 'lucide-react';

function money(value: number) {
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

function saleHasTaxSnapshot(sale: Sale) {
  return Number.isFinite(Number(sale.baseImponibleUSD)) &&
    Number.isFinite(Number(sale.ivaUSD)) &&
    Number.isFinite(Number(sale.exentoUSD));
}

export default function FiscalModule({ state }: { state: AppState }) {
  const today = new Date();
  const [month, setMonth] = useState(String(today.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const periodSales = useMemo(() => {
    return (state.ventas || []).filter((sale) => {
      const date = String(sale.fecha || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const inPeriod = showAll || date.startsWith(year + '-' + month + '-');
      const query = search.trim().toLocaleLowerCase('es');
      const matches = !query || [sale.id, sale.cliente, sale.terminalName, sale.cajeroNombre]
        .some((value) => String(value || '').toLocaleLowerCase('es').includes(query));
      return inPeriod && matches;
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [state.ventas, month, year, search, showAll]);

  const totals = useMemo(() => periodSales.reduce((acc, sale) => {
    acc.total += Number(sale.totalUSD) || 0;
    if (saleHasTaxSnapshot(sale)) {
      acc.base += Number(sale.baseImponibleUSD) || 0;
      acc.iva += Number(sale.ivaUSD) || 0;
      acc.exempt += Number(sale.exentoUSD) || 0;
      acc.withSnapshot += 1;
    } else {
      acc.pending += 1;
    }
    return acc;
  }, { total: 0, base: 0, iva: 0, exempt: 0, withSnapshot: 0, pending: 0 }), [periodSales]);

  const exportCsv = () => {
    const rows = [
      ['Fecha', 'Documento interno', 'Cliente registrado', 'Terminal', 'Base imponible USD', 'IVA USD', 'Exento USD', 'Total USD', 'Estado del desglose'],
      ...periodSales.map((sale) => [
        sale.fecha, sale.id, sale.cliente, sale.terminalName || sale.terminalId || '',
        saleHasTaxSnapshot(sale) ? sale.baseImponibleUSD : '',
        saleHasTaxSnapshot(sale) ? sale.ivaUSD : '',
        saleHasTaxSnapshot(sale) ? sale.exentoUSD : '',
        sale.totalUSD,
        saleHasTaxSnapshot(sale) ? 'Snapshot disponible' : 'Sin desglose fiscal histórico'
      ])
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'libro-ventas-' + (showAll ? 'historico' : year + '-' + month) + '.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const years = Array.from(new Set([today.getFullYear(), ...((state.ventas || []).map(s => Number(String(s.fecha || '').slice(0, 4))).filter(y => y > 2000 && y < 2200))])).sort((a, b) => b - a);

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-brand-gold-soft text-brand-gold-deep flex items-center justify-center"><FileSpreadsheet className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-ink">CENTRO FISCAL</h1>
              <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Libro de ventas · Control de IVA · SENIAT</p>
            </div>
          </div>
        </div>
        <button onClick={exportCsv} disabled={!periodSales.length} className="btn btn-secondary h-11 px-5 flex items-center gap-2 disabled:opacity-40">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex gap-3 text-amber-950">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-sm">
          <strong>Primera fase en construcción.</strong> Esta vista consolida únicamente los datos fiscales que ya están guardados en cada venta. Los documentos internos actuales no se presentan como facturas fiscales SENIAT; tampoco se completan tasas, RIF, números de control ni desglose histórico con datos supuestos.
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <label className="text-xs font-black uppercase text-ink/60 flex flex-col gap-1">Mes
          <select value={month} onChange={e => { setMonth(e.target.value); setShowAll(false); }} className="form-input h-10 min-w-36">
            {months.map((name, index) => <option key={index} value={String(index + 1).padStart(2, '0')}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-black uppercase text-ink/60 flex flex-col gap-1">Año
          <select value={year} onChange={e => { setYear(e.target.value); setShowAll(false); }} className="form-input h-10 min-w-28">
            {years.map(value => <option key={value} value={String(value)}>{value}</option>)}
          </select>
        </label>
        <button onClick={() => setShowAll(value => !value)} className={'h-10 px-4 rounded-lg border text-xs font-black uppercase ' + (showAll ? 'bg-brand-gold text-white border-brand-gold' : 'bg-white border-line text-ink')}>
          {showAll ? 'Mostrando histórico' : 'Ver histórico completo'}
        </button>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-ink/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar documento, cliente o caja..." className="form-input h-10 pl-10 w-full" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-line bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase text-ink/50"><ReceiptText className="w-4 h-4" /> Documentos</div><div className="text-2xl font-black text-ink mt-2">{periodSales.length}</div><div className="text-xs text-ink/45 mt-1">Ventas registradas en el período</div></div>
        <div className="rounded-2xl border border-line bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase text-ink/50"><CircleDollarSign className="w-4 h-4" /> Total vendido</div><div className="text-2xl font-black text-ink mt-2">$ {money(totals.total)}</div><div className="text-xs text-ink/45 mt-1">Importe de las ventas encontradas</div></div>
        <div className="rounded-2xl border border-line bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase text-ink/50"><Percent className="w-4 h-4" /> IVA registrado</div><div className="text-2xl font-black text-ink mt-2">$ {money(totals.iva)}</div><div className="text-xs text-ink/45 mt-1">Solo ventas con snapshot fiscal</div></div>
        <div className="rounded-2xl border border-line bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase text-ink/50"><CalendarDays className="w-4 h-4" /> Pendientes de desglose</div><div className="text-2xl font-black text-amber-700 mt-2">{totals.pending}</div><div className="text-xs text-ink/45 mt-1">No se reconstruyen con tasas actuales</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface-soft p-4"><div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Base imponible identificada</div><div className="text-lg font-black mt-1">$ {money(totals.base)}</div></div>
        <div className="rounded-xl bg-surface-soft p-4"><div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Operaciones exentas registradas</div><div className="text-lg font-black mt-1">$ {money(totals.exempt)}</div></div>
        <div className="rounded-xl bg-surface-soft p-4"><div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Ventas con desglose disponible</div><div className="text-lg font-black mt-1">{totals.withSnapshot} / {periodSales.length}</div></div>
      </div>

      <section className="rounded-2xl border border-line bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-black text-ink">REGISTRO CRONOLÓGICO DE VENTAS</h2><p className="text-xs text-ink/45">Vista preliminar basada en ventas persistidas</p></div>
          <span className="text-xs font-bold text-ink/50">{showAll ? 'Todos los períodos' : months[Number(month) - 1] + ' ' + year}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-surface-soft text-ink/60 uppercase tracking-wider">
              <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Documento interno</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3 text-right">Base USD</th><th className="px-4 py-3 text-right">IVA USD</th><th className="px-4 py-3 text-right">Exento USD</th><th className="px-4 py-3 text-right">Total USD</th><th className="px-4 py-3">Control</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {periodSales.map(sale => {
                const snapshot = saleHasTaxSnapshot(sale);
                return <tr key={sale.id} className="hover:bg-surface-warm/50">
                  <td className="px-4 py-3 whitespace-nowrap">{String(sale.fecha || '').slice(0, 10)}</td>
                  <td className="px-4 py-3 font-bold">{sale.id}</td>
                  <td className="px-4 py-3">{sale.cliente || 'No indicado'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{snapshot ? money(Number(sale.baseImponibleUSD)) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{snapshot ? money(Number(sale.ivaUSD)) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{snapshot ? money(Number(sale.exentoUSD)) : '—'}</td>
                  <td className="px-4 py-3 text-right font-black tabular-nums">{money(Number(sale.totalUSD) || 0)}</td>
                  <td className="px-4 py-3"><span className={'inline-flex rounded-full px-2 py-1 font-bold ' + (snapshot ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{snapshot ? 'Snapshot' : 'Sin desglose'}</span></td>
                </tr>;
              })}
              {!periodSales.length && <tr><td colSpan={8} className="px-4 py-12 text-center text-ink/45">No hay ventas para los filtros seleccionados.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-[11px] text-ink/45">Los campos de RIF, número de control, sucursal fiscal, clasificación exento/exonerado/no sujeto, alícuotas múltiples, notas de crédito/débito fiscales e IGTF desglosado se incorporarán en las siguientes fases con sus validaciones y persistencia propia.</p>
    </div>
  );
}
