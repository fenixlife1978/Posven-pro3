"use client";

import React, { useRef } from 'react';
import { formatBs, formatUsd } from '@/lib/currency-formatter';
import { Utils } from '@/lib/db-store';

declare global {
  interface Window {
    electronAPI?: {
      printTicket: (data: any) => Promise<void>;
      getAppVersion?: () => Promise<string>;
    };
  }
}

type Props = { data: any; onClose: () => void };

const methodLabel: Record<string, string> = {
  efectivo_bs: 'Efectivo Bs',
  efectivo_usd: 'Efectivo USD',
  zelle: 'Zelle',
  pagomovil: 'Pago Móvil',
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  transferencia_bs: 'Transferencia Bs',
  transferencia_usd: 'Transferencia USD',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  credito: 'Crédito',
};

const money = (currency: 'Bs' | 'USD', value: number) =>
  currency === 'Bs' ? formatBs(value) : '$' + formatUsd(value).replace('$', '');

const methodCurrency = (method: string): 'Bs' | 'USD' =>
  ['efectivo_usd', 'zelle', 'transferencia_usd'].includes(String(method).toLowerCase()) ? 'USD' : 'Bs';

export default function ZReportPreview80mm({ data, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const rows = React.useMemo(() => {
    const source = Array.isArray(data?.metodosArqueo) ? data.metodosArqueo : [];
    const map = new Map<string, any>();
    for (const row of source) {
      const method = String(row?.metodo || '').toLowerCase();
      if (!method || ['otros', 'mixto', 'mixtos', 'punto_venta', 'punto_de_venta'].includes(method)) continue;
      map.set(method, row);
    }
    return Array.from(map.entries())
      .map(([method, row]) => {
        const currency = methodCurrency(method);
        const amount = currency === 'USD' ? Number(row?.ventasUSD || 0) : Number(row?.ventasBS || 0);
        return { method, currency, amount };
      })
      .filter((r) => Math.abs(r.amount) > 0.005);
  }, [data?.metodosArqueo]);

  const cxcRows = React.useMemo(() => {
    const source = Array.isArray(data?.cobrosDeudaPorMetodo) ? data.cobrosDeudaPorMetodo : [];
    return source.map((r: any) => {
      const method = String(r?.metodo || '').toLowerCase();
      const currency = methodCurrency(method);
      const amount = currency === 'USD' ? Number(r?.montoUSD || 0) : Number(r?.montoBS || 0);
      return { method, currency, amount };
    }).filter((r: any) => Math.abs(r.amount) > 0.005);
  }, [data?.cobrosDeudaPorMetodo]);

  const salesBs = rows.filter(x => x.currency === 'Bs').reduce((s, x) => s + x.amount, 0);
  const salesUsd = rows.filter(x => x.currency === 'USD').reduce((s, x) => s + x.amount, 0);
  const openingBs = Number(data?.fondoAperturaBS || 0);
  const openingUsd = Number(data?.fondoAperturaUSD || 0);

  const cashSalesBs = rows.filter(x => x.method === 'efectivo_bs').reduce((s, x) => s + x.amount, 0);
  const cashSalesUsd = rows.filter(x => x.method === 'efectivo_usd').reduce((s, x) => s + x.amount, 0);
  const cashCxcBs = cxcRows.filter((x: any) => x.method === 'efectivo_bs').reduce((s: number, x: any) => s + x.amount, 0);
  const cashCxcUsd = cxcRows.filter((x: any) => x.method === 'efectivo_usd').reduce((s: number, x: any) => s + x.amount, 0);
  const movementBs = Number(data?.manualEntradasBS || 0) - Number(data?.manualSalidasBS || 0);
  const movementUsd = Number(data?.manualEntradasUSD || 0) - Number(data?.manualSalidasUSD || 0);
  const expectedBs = openingBs + cashSalesBs + cashCxcBs + movementBs - Number(data?.devEfectivoBS || 0);
  const expectedUsd = openingUsd + cashSalesUsd + cashCxcUsd + movementUsd - Number(data?.devEfectivoUSD || 0);

  const taxes = {
    exento: Number(data?.exentoUSD || 0),
    base: Number(data?.baseImponibleUSD || 0),
    iva: Number(data?.ivaUSD || 0),
    igtf: Number(data?.igtfUSD || 0),
  };
  const hasTaxes = Object.values(taxes).some(v => Math.abs(v) > 0.005);

  const generatedAt = data?.generatedAt || data?.fecha || Utils.ahora();
  const openedAt = data?.openedAt;
  const closedAt = data?.closedAt || generatedAt;
  const userName = String(data?.closedBy || data?.cajeroNombre || 'Cajero');
  const openingUser = String(data?.openedBy || userName);
  const terminal = String(data?.terminalName || data?.terminalId || 'CAJA NO IDENTIFICADA');

  const fmtDate = (value: any) => {
    try { return new Date(value).toLocaleString('es-VE', { timeZone: 'America/Caracas' }); }
    catch { return String(value || '—'); }
  };

  const printHtml = async () => {
    const html = printRef.current?.innerHTML;
    if (!html) return;
    const css = '@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{width:80mm;min-height:80mm;color:#000;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:10px;line-height:1.25}.thermal-report{width:80mm;min-height:80mm;box-sizing:border-box}.flex{display:flex}.justify-between{justify-content:space-between}.gap-2{gap:8px}.text-center{text-align:center}.font-black{font-weight:900}.font-bold{font-weight:700}.border-t{border-top-width:1px}.border-dashed{border-top-style:dashed}.border-double{border-top-style:double}.border-black{border-color:#000}.my-2{margin-top:8px;margin-bottom:8px}.mt-0\\.5{margin-top:2px}.mt-1{margin-top:4px}.text-\\[8px\\]{font-size:8px}.text-\\[10px\\]{font-size:10px}.text-\\[13px\\]{font-size:13px}.tracking-tight{letter-spacing:-.025em}.leading-\\[1\\.25\\]{line-height:1.25}.p-\\[7mm\\]{padding:7mm}.mx-auto{margin-left:auto;margin-right:auto}.bg-white{background:#fff}.text-black{color:#000}.font-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}';
    let appStyles = '';
    try {
      appStyles = Array.from(document.styleSheets).flatMap((sheet) => {
        try { return Array.from(sheet.cssRules).map((rule) => rule.cssText); } catch { return []; }
      }).join('\\n');
    } catch {
      appStyles = '';
    }
    const fullHtml = '<!doctype html><html><head><meta charset="UTF-8"><title>Reporte Z</title><style>' + appStyles + '\\n' + css + '</style></head><body>' + html + '</body></html>';

    if (window.electronAPI?.printTicket) {
      try {
        await window.electronAPI.printTicket([{ type: 'html', value: fullHtml }]);
        return;
      } catch (error) {
        console.error('Error en impresión térmica nativa del Reporte Z:', error);
      }
    }

    const win = window.open('', '_blank', 'width=420,height=800');
    if (!win) return;
    win.document.write(fullHtml);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
      win.onafterprint = () => win.close();
    };
  };

  return (
    <div className="fixed inset-0 z-[180] bg-slate-950/70 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[95vh] bg-slate-100 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-3 bg-white border-b flex items-center justify-between gap-3 shrink-0">
          <div>
            <h3 className="font-black text-slate-900">Vista previa — Reporte Z</h3>
            <p className="text-xs text-slate-500">Formato real de impresión térmica 80 mm</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border text-xs font-bold bg-white">Cerrar</button>
            <button onClick={() => { void printHtml(); }} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-black">Imprimir 80 mm</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div ref={printRef} className="thermal-report mx-auto bg-white text-black font-mono text-[10px] leading-[1.25] p-[7mm] shadow-xl" style={{ width: '80mm', minHeight: '80mm', boxSizing: 'border-box' }}>
            <div className="text-center font-black text-[13px] tracking-tight">REPORTE Z</div>
            <div className="text-center font-bold mt-0.5">CONTROL DE CAJA</div>
            <div className="border-t border-dashed border-black my-2" />

            <div className="text-center font-black">{String(data?.empresa?.nombre || data?.businessName || data?.empresaNombre || data?.companyName || 'POSVEN PRO')}</div>
            {data?.empresa?.rif && <div className="text-center font-bold">RIF: {String(data.empresa.rif)}</div>}
            <div className="text-center">{String(data?.empresa?.subtitulo || data?.businessSubtitle || 'CONTROL OPERATIVO DE CAJA')}</div>
            <div className="border-t border-dashed border-black my-2" />

            <div className="flex justify-between"><span>Terminal</span><b>{terminal}</b></div>
            <div className="flex justify-between"><span>Usuario apertura</span><span>{openingUser}</span></div>
            <div className="flex justify-between"><span>Fecha emisión</span><span>{fmtDate(generatedAt)}</span></div>
            {openedAt && <div className="flex justify-between"><span>Apertura</span><span>{fmtDate(openedAt)}</span></div>}
            <div className="flex justify-between"><span>Cierre</span><span>{fmtDate(closedAt)}</span></div>
            <div className="flex justify-between"><span>Usuario cierre</span><span>{userName}</span></div>

            <div className="border-t border-dashed border-black my-2" />
            <div className="font-black">RESUMEN DE VENTAS</div>
            <div className="flex justify-between"><span>Ventas USD</span><b>{money('USD', Number(data?.totalVentasUSD ?? data?.brUSD ?? 0))}</b></div>
            <div className="flex justify-between"><span>Ventas Bs</span><b>{money('Bs', salesBs)}</b></div>
            <div className="flex justify-between"><span>Ventas USD por cobro</span><b>{money('USD', salesUsd)}</b></div>

            <div className="border-t border-dashed border-black my-2" />
            <div className="font-black">MEDIOS DE PAGO</div>
            {rows.length === 0 ? <div>Sin operaciones.</div> : rows.map(line => (
              <div key={line.method + line.currency} className="flex justify-between gap-2"><span>{methodLabel[line.method] || line.method}</span><b>{money(line.currency, line.amount)}</b></div>
            ))}

            <div className="border-t border-dashed border-black my-2" />
            <div className="font-black">COBROS CxC</div>
            {cxcRows.length === 0 ? <div>Sin cobros registrados.</div> : cxcRows.map((line: any) => (
              <div key={'cxc-' + line.method + line.currency} className="flex justify-between gap-2"><span>{methodLabel[line.method] || line.method}</span><b>{money(line.currency, line.amount)}</b></div>
            ))}

            {hasTaxes && (
              <>
                <div className="border-t border-dashed border-black my-2" />
                <div className="font-black">DESGLOSE DE IMPUESTOS</div>
                {taxes.exento > 0 && <div className="flex justify-between"><span>Ventas exentas</span><b>{money('USD', taxes.exento)}</b></div>}
                {taxes.base > 0 && <div className="flex justify-between"><span>Base imponible (G)</span><b>{money('USD', taxes.base)}</b></div>}
                {taxes.iva > 0 && <div className="flex justify-between"><span>IVA recaudado</span><b>{money('USD', taxes.iva)}</b></div>}
                {taxes.igtf > 0 && <div className="flex justify-between"><span>IGTF recaudado</span><b>{money('USD', taxes.igtf)}</b></div>}
              </>
            )}

            <div className="border-t border-dashed border-black my-2" />
            <div className="font-black">EFECTIVO</div>
            <div className="flex justify-between"><span>Fondo inicial Bs</span><b>{money('Bs', openingBs)}</b></div>
            <div className="flex justify-between"><span>Fondo inicial USD</span><b>{money('USD', openingUsd)}</b></div>
            <div className="flex justify-between"><span>Ventas efectivo Bs</span><b>{money('Bs', cashSalesBs)}</b></div>
            <div className="flex justify-between"><span>Ventas efectivo USD</span><b>{money('USD', cashSalesUsd)}</b></div>
            <div className="flex justify-between"><span>Cobros CxC Bs</span><b>{money('Bs', cashCxcBs)}</b></div>
            <div className="flex justify-between"><span>Cobros CxC USD</span><b>{money('USD', cashCxcUsd)}</b></div>
            <div className="flex justify-between"><span>Movimientos Bs</span><b>{money('Bs', movementBs)}</b></div>
            <div className="flex justify-between"><span>Movimientos USD</span><b>{money('USD', movementUsd)}</b></div>
            <div className="flex justify-between font-black"><span>EFECTIVO ESPERADO Bs</span><b>{money('Bs', expectedBs)}</b></div>
            <div className="flex justify-between font-black"><span>EFECTIVO ESPERADO USD</span><b>{money('USD', expectedUsd)}</b></div>

            <div className="border-t border-double border-black my-2" />
            <div className="font-black">CIERRE Y ARQUEO</div>
            <div className="flex justify-between"><span>Contado Bs</span><b>{money('Bs', Number(data?.totalNetoEfectivoBS || 0))}</b></div>
            <div className="flex justify-between"><span>Diferencia Bs</span><b>{money('Bs', Number(data?.differenceBs || 0))}</b></div>
            <div className="flex justify-between"><span>Contado USD</span><b>{money('USD', Number(data?.totalNetoEfectivoUSD || 0))}</b></div>
            <div className="flex justify-between"><span>Diferencia USD</span><b>{money('USD', Number(data?.differenceUSD || 0))}</b></div>

            <div className="border-t border-dashed border-black my-2" />
            <div className="text-center font-black">FIN DEL REPORTE Z</div>
            <div className="text-center text-[8px] mt-1">Documento operativo de control de caja</div>
          </div>
        </div>
      </div>
    </div>
  );
}
