"use client";

import React, { useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, X, Zap, Share2, Monitor } from 'lucide-react';
import { Store, Utils } from '@/lib/db-store';
import { formatBs, formatUsd } from '@/lib/currency-formatter';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

declare global {
  interface Window {
    electronAPI?: {
      printTicket: (data: any) => Promise<void>;
      getAppVersion: () => Promise<string>;
    };
  }
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  saleData?: any;
  reportData?: any;
  type?: 'SALE' | 'REPORT_X' | 'REPORT_Z';
  storeInfo?: any;
}

export function ReceiptModal({ isOpen, onClose, saleData, reportData, type = 'SALE', storeInfo }: Props) {
  const state = Store.get();
  const printRef = useRef<HTMLDivElement>(null);
  const isReport = type === 'REPORT_X' || type === 'REPORT_Z';
  const data = isReport ? reportData : saleData;
  
  if (!data) {
    return null;
  }

  const transactionDate = React.useMemo(() => {
    try {
      const rawDate = data.fecha || data.date || data.createdAt || Utils.ahora();
      const dateObj = new Date(rawDate);
      
      if (isNaN(dateObj.getTime())) {
        return new Date().toLocaleString('es-VE', { 
          timeZone: 'America/Caracas',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true 
        });
      }
      
      return dateObj.toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    }
  }, [data.fecha, data.date, data.createdAt]);

  const customerName = React.useMemo(() => {
    if (data.cliente) return data.cliente.toUpperCase();
    if (data.customer?.name) return data.customer.name.toUpperCase();
    if (data.customerName) return data.customerName.toUpperCase();
    return 'CONSUMIDOR FINAL';
  }, [data.cliente, data.customer, data.customerName]);

  const getReportTitle = () => {
    if (type === 'REPORT_Z') return '*** REPORTE Z ***';
    if (type === 'REPORT_X') return '*** ARQUEO DE CAJA ***';
    return data.type || 'RECIBO DE VENTA';
  };

  const getReportSubtitle = () => {
    if (type === 'REPORT_Z') return '(CIERRE DIARIO)';
    if (type === 'REPORT_X') return '(LECTURA PARCIAL)';
    return '';
  };

  const getItems = () => {
    if (data.items) return data.items;
    if (data.products) return data.products;
    if (data.detalles) return data.detalles;
    return [];
  };

  const receiptNumber = React.useMemo(() => {
    if (isReport) {
      if (type === 'REPORT_Z') return `Z-${String(data.numeroZ || 0).padStart(6, '0')}`;
      return String(data.numeroX || data.numeroZ || 0).padStart(6, '0');
    }
    if (data.id) return String(data.id);
    if (data.numero) return String(data.numero);
    if (data.controlNumber) return String(data.controlNumber);
    return 'N/A';
  }, [data.id, data.numero, data.controlNumber, data.numeroZ, data.numeroX, isReport, type]);

  const terminalId = React.useMemo(() => {
    if (data.terminalName) return String(data.terminalName);
    if (data.caja) return String(data.caja);
    if (data.terminal) return String(data.terminal);
    if (data.terminalId) return String(data.terminalId);
    return 'CAJA-01';
  }, [data.terminalName, data.caja, data.terminal, data.terminalId]);

  const cajeroNombre = React.useMemo(() => {
    if (data.cajeroNombre) return data.cajeroNombre;
    if (data.cajero) return data.cajero;
    if (data.cashier) return data.cashier;

    // En X/Z no usar el usuario cacheado globalmente: el reporte ya trae
    // el cajero ligado al terminal que se está arqueando.
    if (isReport) return 'Cajero';

    const currentUser = (state as any).user;
    if (currentUser) {
      return currentUser.nombre || currentUser.name || currentUser.displayName || currentUser.email || 'Cajero';
    }
    return 'Cajero';
  }, [data.cajeroNombre, data.cajero, data.cashier, isReport]);

  const totalBs = React.useMemo(() => {
    if (data.totalBS) return data.totalBS;
    if (data.totalBs) return data.totalBs;
    if (data.total) return data.total;
    if (data.ventaNetaUSD) return data.ventaNetaUSD * state.tasa;
    return 0;
  }, [data.totalBS, data.totalBs, data.total, data.ventaNetaUSD, state.tasa]);

  const totalUsd = React.useMemo(() => {
    if (data.totalUSD) return data.totalUSD;
    if (data.totalUsd) return data.totalUsd;
    if (data.total) return data.total / (state.tasa || 1);
    if (data.ventaNetaUSD) return data.ventaNetaUSD;
    return 0;
  }, [data.totalUSD, data.totalUsd, data.total, data.ventaNetaUSD, state.tasa]);

  // ===== FUNCIÓN PARA OBTENER MÉTODOS DE PAGO =====
  const getPaymentMethods = () => {
    if (data.payments && Array.isArray(data.payments) && data.payments.length > 0) {
      return data.payments;
    }
    if (data.paymentMethods && typeof data.paymentMethods === 'object') {
      return data.paymentMethods;
    }
    if (data.metodosPago && typeof data.metodosPago === 'object') {
      return data.metodosPago;
    }
    if (data.formasPago && typeof data.formasPago === 'object') {
      return data.formasPago;
    }
    if (data.metodoPago) {
      return { [data.metodoPago]: data.totalUSD || totalUsd };
    }
    return {};
  };

  // ===== FORMATO DE MÉTODO DE PAGO =====
  const formatPaymentMethod = (method: string) => {
    const methods: {[key: string]: string} = {
      'efectivo': 'EFECTIVO',
      'efectivo_bs': 'EFECTIVO (Bs.)',
      'efectivo_usd': 'EFECTIVO (USD)',
      'pago_movil': 'PAGO MÓVIL',
      'pagomovil': 'PAGO MÓVIL',
      'punto_venta': 'PUNTO DE VENTA',
      'punto_de_venta': 'PUNTO DE VENTA',
      'tarjeta': 'TARJETA',
      'tarjeta_credito': 'TARJETA CRÉDITO',
      'tarjeta_debito': 'TARJETA DÉBITO',
      'credito': 'CRÉDITO',
      'zelle': 'ZELLE',
      'mixto': 'MIXTO',
      'biopago': 'BIOPAGO',
      'transferencia': 'TRANSFERENCIA'
    };
    return methods[method.toLowerCase()] || method.toUpperCase();
  };

  // ===== DETECTAR SI ES PAGO EN USD =====
  const isUsdPayment = (method: string) => {
    const usdMethods = ['efectivo_usd', 'efectivo usd', 'usd', 'dolar', 'zelle'];
    return usdMethods.some(m => method.toLowerCase().includes(m));
  };

  const [arqueoReal, setArqueoReal] = React.useState<Record<string, string>>({});
  const arqueoRows = React.useMemo(() => {
    const rows = (Array.isArray(data?.metodosArqueo) ? data.metodosArqueo : [])
      .filter((r:any) => !['otros','mixto','mixtos','punto_venta','punto_de_venta','punto_pago','punto_de_pago'].includes(String(r?.metodo || '').toLowerCase()));
    const base = ['efectivo_bs','efectivo_usd','pagomovil','tarjeta','biopago','transferencia','zelle','credito'];
    const map = new Map<string, any>();
    [...base, ...rows.map((r:any) => r.metodo)].forEach((metodo) => { if (metodo) map.set(metodo, rows.find((r:any)=>r.metodo===metodo) || {metodo,ventasBS:0,ventasUSD:0,cobrosBS:0,cobrosUSD:0,devBS:0,devUSD:0,moneda: isUsdPayment(metodo) ? 'USD' : 'BS'}); });
    return Array.from(map.values());
  }, [data?.metodosArqueo]);
  const arqueoCalc = React.useMemo(() => {
    const details = arqueoRows.map((r:any) => {
      const usd = r.moneda === 'USD';
      const fondo = r.metodo === 'efectivo_bs' ? Number(data?.fondoAperturaBS || 0) : r.metodo === 'efectivo_usd' ? Number(data?.fondoAperturaUSD || 0) : 0;
      const ventas = r.metodo === 'tarjeta' && !(Number(r.ventasBS) > 0)
        ? Number(r.ventasUSD || 0) * Number(state.tasa || 0)
        : (usd ? Number(r.ventasUSD || 0) : Number(r.ventasBS || 0));
      const cobros = usd ? Number(r.cobrosUSD || 0) : Number(r.cobrosBS || 0);
      const dev = usd ? Number(r.devUSD || 0) : Number(r.devBS || 0);
      // Las ventas a crédito se expresan en el Arqueo en su equivalente en BS.
      // El origen está en USD, por lo que se convierte con la tasa BCV vigente.
      const credito = r.metodo === 'credito'
        ? Number(data?.ventasCreditoUSD || 0) * Number(state.tasa || 0)
        : 0;
      const movPlus = usd ? Number(r.movPlusUSD || 0) : Number(r.movPlusBS || 0);
      const movMinus = usd ? Number(r.movMinusUSD || 0) : Number(r.movMinusBS || 0);
      const sistema = r.metodo === 'credito' ? credito : fondo + ventas + cobros - dev + movPlus - movMinus;
      const real = r.metodo === 'credito' ? sistema : (arqueoReal[r.metodo] === undefined || arqueoReal[r.metodo] === '' ? null : Number(arqueoReal[r.metodo]));
      return { ...r, usd, fondo, ventas, cobros, dev, credito, movPlus, movMinus, sistema, real, dif: real === null ? null : real - sistema };
    });
    const difBS = details.filter((r:any)=>!r.usd && r.real !== null).reduce((s:number,r:any)=>s+r.dif,0);
    const difUSD = details.filter((r:any)=>r.usd && r.real !== null).reduce((s:number,r:any)=>s+r.dif,0);
    return {details,difBS,difUSD,conciliado:Math.abs(difBS)<0.005 && Math.abs(difUSD)<0.005};
  }, [arqueoRows, arqueoReal, data?.fondoAperturaBS, data?.fondoAperturaUSD, data?.ventasCreditoUSD]);

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const isArqueo = type === 'REPORT_X';
    printWindow.document.write(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${isArqueo ? 'Arqueo_de_Caja_PosVEN_Pro' : 'Impresion_PosVEN_Pro'}</title>
          <style>
            @page { size: ${isArqueo ? 'A4 landscape' : '80mm auto'}; margin: ${isArqueo ? '10mm' : '0'}; }
            body {
              font-family: Arial, Helvetica, sans-serif;
              width: ${isArqueo ? '100%' : '72mm'};
              margin: 0 auto;
              padding: ${isArqueo ? '0' : '4mm'};
              font-size: ${isArqueo ? '9px' : '12px'};
              color: #000;
              background: #fff;
              line-height: 1.2;
            }
            table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
            th, td { vertical-align: middle; padding: ${isArqueo ? '4px 5px' : '1px 0'}; }
            th { background: #111; color: #fff; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .bold { font-weight: bold; }
            .separator-dashed { border-top: 1px dashed #000; margin: 4px 0; }
            .separator-solid { border-top: 1px solid #000; margin: 4px 0; }
            .spacer { height: 6px; }
            input { border: 1px solid #999; background: #fff; color: #000; }
            .overflow-x-auto { overflow: visible !important; }
            .min-w-\\[920px\\] { min-width: 0 !important; width: 100% !important; }
            @media print { input { border: 0; font-weight: bold; text-align: right; } }
          </style>
        </head>
        <body>
          ${printContent}
          <script>
            window.onload = function() {
              window.focus();
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const generateArqueoPdf = async (): Promise<Blob> => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const empresa = state.empresa?.nombre || 'POSVEN PRO';
    const subtitle = `Caja: ${terminalId} · Fecha: ${transactionDate}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(empresa, 14, 14);
    doc.setFontSize(13);
    doc.text('ARQUEO DE CAJA', 14, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(subtitle, 14, 28);
    doc.text(`Cajero: ${cajeroNombre}`, 14, 33);

    const money = (v:number, usd:boolean) => usd ? `$ ${formatUsd(v)}` : formatBs(v);
    const body = arqueoCalc.details.map((r:any) => [
      formatPaymentMethod(r.metodo),
      r.metodo === 'efectivo_bs' ? formatBs(r.fondo) : '—',
      r.metodo === 'efectivo_usd' ? '$ ' + formatUsd(r.fondo) : '—',
      money(r.ventas, r.usd),
      money(r.cobros, r.usd),
      r.dev ? '(' + money(r.dev, r.usd) + ')' : '—',
      r.movPlus ? money(r.movPlus, r.usd) : '—',
      r.movMinus ? '(' + money(r.movMinus, r.usd) + ')' : '—',
      money(r.sistema, r.usd),
      r.real === null ? 'PENDIENTE' : money(r.real, r.usd),
      r.dif === null ? '—' : ((r.dif >= 0 ? '+' : '') + money(r.dif, r.usd))
    ]);

    autoTable(doc, {
      startY: 38,
      head: [['CONCEPTO','FONDO INIC. BS','FONDO INIC. USD','VENTAS','COBROS DE DEUDAS','DEV./ANU.','MOV. CAJA (+)','MOV. CAJA (-)','TOTAL MONTO SISTEMA','MONTO REAL','DIF. (+ / -)']],
      body,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: 2, valign: 'middle' },
      headStyles: { fillColor: [20,20,20], textColor: [255,255,255], fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 22 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 4: { cellWidth: 25 }, 5: { cellWidth: 20 }, 6: { cellWidth: 22 }, 7: { cellWidth: 22 }, 8: { cellWidth: 27 }, 9: { cellWidth: 25 }, 10: { cellWidth: 23 } },
      didParseCell: (hook:any) => {
        if (hook.section === 'body' && (hook.column.index === 5 || hook.column.index === 7)) hook.cell.styles.textColor = [190, 30, 30];
        if (hook.section === 'body' && hook.column.index === 6) hook.cell.styles.textColor = [20, 120, 60];
      }
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 80;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('RESULTADO FINAL GLOBAL', 14, finalY + 10);
    doc.setFontSize(11);
    doc.text(arqueoCalc.conciliado ? 'CONCILIADO' : 'DIFERENCIA (+ / -)', 14, finalY + 17);
    doc.setFontSize(8);
    doc.text(`Diferencia Bs.: ${arqueoCalc.difBS >= 0 ? '+' : ''}${formatBs(arqueoCalc.difBS)}    Diferencia USD: ${arqueoCalc.difUSD >= 0 ? '+$ ' : '-$ '}${formatUsd(Math.abs(arqueoCalc.difUSD))}`, 14, finalY + 23);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Documento de control interno. No válido como cierre fiscal.', 14, finalY + 30);
    return doc.output('blob');
  };

  const handleDownloadArqueoPdf = async () => {
    const blob = await generateArqueoPdf();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Arqueo-Caja-${terminalId}-${new Date().toISOString().slice(0,10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleShareArqueoPdf = async () => {
    const blob = await generateArqueoPdf();
    const file = new File([blob], `Arqueo-Caja-${terminalId}.pdf`, { type: 'application/pdf' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: 'Arqueo de Caja', text: `Arqueo de Caja · ${terminalId}`, files: [file] });
      return;
    }
    await handleDownloadArqueoPdf();
  };

  const handleNativePrint = async () => {
    if (!window.electronAPI) {
      handlePrint();
      return;
    }

    try {
      const printContent = printRef.current?.innerHTML;
      if (!printContent) return;

      const fullHtml = `
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              @page { size: 80mm auto; margin: 0; }
              body {
                font-family: monospace;
                width: 72mm;
                margin: 0 auto;
                padding: 4mm;
                font-size: 12px;
                color: #000;
                background: #fff;
                line-height: 1.2;
                letter-spacing: normal;
              }
              table { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
              td { vertical-align: top; padding: 1px 0; }
              .text-center { text-align: center; }
              .text-right { text-align: right; }
              .bold { font-weight: bold; }
              .separator-dashed { border-top: 1px dashed #000; margin: 4px 0; }
              .separator-solid { border-top: 1px solid #000; margin: 4px 0; }
              .spacer { height: 6px; }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `;

      await window.electronAPI.printTicket([{ type: 'html', value: fullHtml }]);
      setTimeout(onClose, 500);
    } catch (e) {
      console.error('Error en impresión nativa:', e);
      handlePrint();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={type === 'REPORT_X' ? "w-[98vw] max-w-[1500px] p-0 bg-transparent border-none overflow-hidden shadow-none" : "sm:max-w-[440px] p-0 bg-transparent border-none overflow-hidden shadow-none"}>
        <DialogHeader className="sr-only"><DialogTitle>{type === 'REPORT_X' ? 'Arqueo de Caja' : 'Impresión Térmica'}</DialogTitle></DialogHeader>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-200 h-[96vh] max-h-[96vh] w-full">
          <div className="bg-black p-4 flex justify-between items-center shrink-0">
            <h3 className="text-white font-black text-xs flex items-center gap-2 tracking-widest uppercase">
              <Printer size={16} className="text-brand-gold" /> {type === 'REPORT_X' ? 'VISTA PREVIA · ARQUEO DE CAJA' : 'VISTA PREVIA (42C)'}
            </h3>
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={20} /></button>
          </div>

          <div className={type === 'REPORT_X' ? "p-2 sm:p-4 bg-gray-100 flex justify-center flex-1 min-h-0 overflow-auto custom-scrollbar" : "p-6 bg-gray-100 flex justify-center max-h-[70vh] overflow-y-auto custom-scrollbar"}>
            <div 
              ref={printRef}
              className={type === 'REPORT_X'
                ? "bg-white w-full max-w-none p-4 sm:p-6 shadow-sm text-black select-none"
                : "bg-white p-6 shadow-sm text-black font-mono select-none"}
              style={type === 'REPORT_X'
                ? { width: '100%', boxSizing: 'border-box', color: '#000', fontSize: '12px', lineHeight: '1.2' }
                : { width: '72mm', boxSizing: 'border-box', color: '#000', fontSize: '12px', lineHeight: '1.2' }}
            >
              {/* ENCABEZADO */}
              <div className="text-center pb-1">
                <div className="text-[18px] font-bold uppercase leading-tight">{state.empresa.nombre}</div>
                {state.empresa.rif && <div className="font-bold">RIF: {state.empresa.rif}</div>}
                {state.empresa.direccion && <div className="text-[10px] uppercase">{state.empresa.direccion}</div>}
              </div>

              <div className="text-center mt-2">
                <div className="text-[16px] font-bold uppercase">{getReportTitle()}</div>
                {isReport && <div className="font-bold">{getReportSubtitle()}</div>}
              </div>

              <div className="separator-dashed"></div>

              {/* INFO DOCUMENTO */}
              <table className="text-[11px] font-bold">
                <tbody>
                  <tr><td>FECHA: {transactionDate.split(',')[0]}</td><td className="text-right">HORA: {transactionDate.split(',')[1]?.trim()}</td></tr>
                  <tr><td>Nº {isReport ? (type === 'REPORT_Z' ? 'Z' : 'X') : 'RECIBO'}: {receiptNumber}</td><td className="text-right">CAJA: {terminalId}</td></tr>
                  <tr><td colSpan={2}>CAJERO: {cajeroNombre?.toUpperCase()}</td></tr>
                  {!isReport && <tr><td colSpan={2}>CLIENTE: {customerName}</td></tr>}
                </tbody>
              </table>

              <div className="separator-dashed"></div>

              {/* CONTENIDO REPORTES X/Z */}
              {isReport && (type === 'REPORT_X' ? (
                <div className="space-y-3">
                  <div className="text-center font-black text-[15px]">ARQUEO DE CAJA</div>
                  <div className="text-[9px] text-center font-bold">LECTURA PARCIAL · CAJA {terminalId}</div>
                  <div className="overflow-x-auto border border-gray-300 rounded-lg">
                    <table className="w-full text-[7px] sm:text-[8px] border-collapse">
                      <thead><tr className="bg-black text-white"><th className="p-2 text-left">CONCEPTO</th><th className="p-2 text-right">FONDO INIC. BS</th><th className="p-2 text-right">FONDO INIC. USD</th><th className="p-2 text-right">VENTAS</th><th className="p-2 text-right">COBROS DE DEUDAS</th><th className="p-2 text-right">DEV./ANU.</th><th className="p-2 text-right">MOV. CAJA (+)</th><th className="p-2 text-right">MOV. CAJA (-)</th><th className="p-2 text-right">TOTAL MONTO SISTEMA</th><th className="p-2 text-right">MONTO REAL</th><th className="p-2 text-right">DIF. (+ / -)</th></tr></thead>
                      <tbody>
                        {arqueoCalc.details.map((r:any) => (
                          <tr key={r.metodo} className="border-b border-gray-200">
                            <td className="p-2 font-bold">{formatPaymentMethod(r.metodo)}</td>
                            <td className="p-2 text-right">{r.metodo==='efectivo_bs' ? formatBs(r.fondo) : '—'}</td>
                            <td className="p-2 text-right">{r.metodo==='efectivo_usd' ? '$ '+formatUsd(r.fondo) : '—'}</td>
                            <td className="p-2 text-right">{r.ventas ? (r.usd ? '$ '+formatUsd(r.ventas) : formatBs(r.ventas)) : '—'}</td>
                            <td className="p-2 text-right">{r.cobros ? (r.usd ? '$ '+formatUsd(r.cobros) : formatBs(r.cobros)) : '—'}</td>
                            <td className="p-2 text-right text-red-600">{r.dev ? (r.usd ? '($ '+formatUsd(r.dev)+')' : '('+formatBs(r.dev)+')') : '—'}</td>
                            <td className="p-2 text-right text-green-700">{r.movPlus ? (r.usd ? '$ '+formatUsd(r.movPlus) : formatBs(r.movPlus)) : '—'}</td>
                            <td className="p-2 text-right text-red-600">{r.movMinus ? (r.usd ? '($ '+formatUsd(r.movMinus)+')' : '('+formatBs(r.movMinus)+')') : '—'}</td>
                            <td className="p-2 text-right font-black">{r.usd ? '$ '+formatUsd(r.sistema) : formatBs(r.sistema)}</td>
                            <td className="p-1 text-right">{r.metodo==='credito' ? (r.usd ? '$ '+formatUsd(r.sistema) : formatBs(r.sistema)) : <input value={arqueoReal[r.metodo] ?? ''} onChange={e=>setArqueoReal(prev=>({...prev,[r.metodo]:e.target.value}))} inputMode="decimal" className="w-24 h-7 border border-gray-400 rounded px-1 text-right font-bold bg-white text-black" placeholder={r.usd ? 'USD' : 'Bs.'} />}</td>
                            <td className={(r.dif === null ? 'p-2 text-right font-black text-gray-400' : 'p-2 text-right font-black '+(r.dif >= 0 ? 'text-green-700' : 'text-red-600'))}>{r.dif === null ? '—' : (r.usd ? (r.dif>=0?'+':'')+'$ '+formatUsd(r.dif) : (r.dif>=0?'+':'')+formatBs(r.dif))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t-2 border-black pt-3 space-y-2">
                    <div className="font-black text-center text-[12px]">RESULTADO FINAL GLOBAL</div>
                    <div className={'text-center font-black text-[14px] '+(arqueoCalc.conciliado ? 'text-green-700' : 'text-red-600')}>{arqueoCalc.conciliado ? 'CONCILIADO' : 'DIFERENCIA (+ / -)'}</div>
                    {!arqueoCalc.conciliado && <div className="text-center font-black text-[10px]">BS: {arqueoCalc.difBS>=0?'+':''}{formatBs(arqueoCalc.difBS)} · USD: {arqueoCalc.difUSD>=0?'+$ ':'-$ '}{formatUsd(Math.abs(arqueoCalc.difUSD))}</div>}
                  </div>
                  <div className="text-center font-bold text-[8px]">DOCUMENTO NO VÁLIDO COMO CIERRE FISCAL</div>
                </div>
              ) : (
                <div className="space-y-1">
                   {type === 'REPORT_Z' && (
                     <>
                       <div className="text-center font-bold">CONTROL DE DOCUMENTOS</div>
                       <div className="separator-dashed"></div>
                       <table><tbody>
                         <tr><td>DESDE FACTURA:</td><td className="text-right">{data.desdeFactura}</td></tr>
                         <tr><td>HASTA FACTURA:</td><td className="text-right">{data.hastaFactura}</td></tr>
                         <tr><td>TOTAL FACTURAS:</td><td className="text-right">{data.stats?.facturas}</td></tr>
                         <tr><td colSpan={2} className="spacer"></td></tr>
                         <tr><td>DESDE N. CRÉDITO:</td><td className="text-right">{data.desdeNC}</td></tr>
                         <tr><td>HASTA N. CRÉDITO:</td><td className="text-right">{data.hastaNC}</td></tr>
                         <tr><td>TOTAL N. CRÉDITO:</td><td className="text-right">{data.stats?.devoluciones}</td></tr>
                         <tr><td>ANULACIONES:</td><td className="text-right">{data.stats?.anulaciones}</td></tr>
                       </tbody></table>
                       <div className="separator-dashed"></div>
                     </>
                   )}

                   <div className="text-center font-bold">RESUMEN DE OPERACIONES</div>
                   <div className="separator-dashed"></div>
                   <table><tbody>
                     <tr><td>VENTAS BRUTAS:</td><td className="text-right">{formatBs(data.brUSD * state.tasa)}</td></tr>
                     <tr><td>DESCUENTOS:</td><td className="text-right">{formatBs(data.descUSD * state.tasa)}</td></tr>
                     <tr><td>DEVOLUCIONES:</td><td className="text-right">{formatBs(data.devUSD * state.tasa)}</td></tr>
                     <tr><td className="bold">VENTAS NETAS:</td><td className="text-right bold">{formatBs(data.netUSD * state.tasa)}</td></tr>
                   </tbody></table>

                   {/* ===== TOTAL VENTAS DEL DÍA EN USD (solicitado por usuario) ===== */}
                   <div className="separator-dashed"></div>
                   <div className="text-center font-bold">TOTAL VENTAS DEL DÍA (USD)</div>
                   <div className="separator-dashed"></div>
                   <table><tbody>
                     <tr className="bold">
                       <td>VENTAS TOTALES USD:</td>
                       <td className="text-right">$ {formatUsd(data.totalVentasUSD ?? data.brUSD ?? 0)}</td>
                     </tr>
                     <tr className="bold">
                       <td>VENTAS NETAS USD:</td>
                       <td className="text-right">$ {formatUsd(data.netUSD ?? 0)}</td>
                     </tr>
                     {data.tasaBCV > 0 && (
                       <tr className="text-[10px]">
                         <td colSpan={2} className="text-center">Tasa BCV: Bs. {Number(data.tasaBCV).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                       </tr>
                     )}
                   </tbody></table>

                   <div className="separator-dashed"></div>
                   <div className="text-center font-bold">DESGLOSE DE IMPUESTOS</div>
                   <div className="separator-dashed"></div>
                   <table><tbody>
                     <tr><td>VENTAS EXENTAS (E):</td><td className="text-right">{formatBs(data.exentoUSD * state.tasa)}</td></tr>
                     <tr><td>BASE IMPONIBLE (G 16%):</td><td className="text-right">{formatBs(data.baseImponibleUSD * state.tasa)}</td></tr>
                     <tr><td>IVA RECAUDADO (16%):</td><td className="text-right">{formatBs(data.ivaUSD * state.tasa)}</td></tr>
                     <tr><td>RECAUDACIÓN IGTF (3%):</td><td className="text-right">{formatBs(data.igtfUSD * state.tasa)}</td></tr>
                   </tbody></table>

                   <div className="separator-dashed"></div>
                   
                   {/* ===== DESGLOSE DE MÉTODOS DE PAGO ===== */}
                   <div className="text-center font-bold">DESGLOSE POR MÉTODOS DE PAGO</div>
                   <div className="separator-dashed"></div>
                   <table><tbody>
                     {(() => {
                       const paymentMethods = getPaymentMethods();
                       
                       if (Object.keys(paymentMethods).length > 0) {
                         if (Array.isArray(paymentMethods)) {
                           return paymentMethods.map((p: any, idx: number) => {
                             const method = p.metodo || p.method || 'efectivo';
                             const amountUSD = p.montoUSD || p.amountUSD || p.monto || p.amount || 0;
                             const amountBS = p.montoBS || p.amountBS || (amountUSD * state.tasa) || 0;
                             const isUsd = isUsdPayment(method);
                             
                             return (
                               <tr key={idx}>
                                 <td>{formatPaymentMethod(method)}:</td>
                                 <td className="text-right">{isUsd ? `$ ${formatUsd(amountUSD)}` : formatBs(amountBS)}</td>
                               </tr>
                             );
                           });
                         } else {
                           return Object.entries(paymentMethods).map(([method, amount], idx) => {
                             const amountNum = typeof amount === 'number' ? amount : 0;
                             const amountUSD = amountNum;
                             const amountBS = amountNum * state.tasa;
                             const isUsd = isUsdPayment(method);
                             
                             return (
                               <tr key={idx}>
                                 <td>{formatPaymentMethod(method)}:</td>
                                 <td className="text-right">{isUsd ? `$ ${formatUsd(amountUSD)}` : formatBs(amountBS)}</td>
                               </tr>
                             );
                           });
                         }
                       }
                       return <tr><td colSpan={2} className="text-center">SIN DATOS DE PAGO</td></tr>;
                     })()}
                   </tbody></table>

                   <div className="separator-dashed"></div>

                   {type === 'REPORT_Z' && (
                     <>
                        <div className="separator-dashed"></div>
                        <div className="text-center font-bold">FLUJO DE CAJA</div>
                        <div className="separator-dashed"></div>
                        {(() => {
                          const fondoBs = Number(data.fondoAperturaBS ?? data.fondoAperturaBs ?? 0);
                          const fondoUsd = Number(data.fondoAperturaUSD ?? data.fondoAperturaUsd ?? 0);
                          const estimadoBS = data.estimadoEfectivoBS || {};
                          const estimadoUSD = data.estimadoEfectivoUSD || {};
                          const entradasBs = Number(estimadoBS.entradas) || 0;
                          const entradasUsd = Number(estimadoUSD.entradas) || 0;
                          const egresosBs = Number(estimadoBS.egresos) || 0;
                          const egresosUsd = Number(estimadoUSD.egresos) || 0;
                          return (
                            <table><tbody>
                              <tr><td>FONDO INICIAL BS:</td><td className="text-right">{formatBs(fondoBs)}</td></tr>
                              <tr><td>FONDO INICIAL USD:</td><td className="text-right">$ {formatUsd(fondoUsd)}</td></tr>
                              <tr className="text-[10px] text-green-700">
                                <td>MOVIMIENTOS DE CAJA (+) — INGRESOS BS:</td>
                                <td className="text-right">{formatBs(entradasBs)}</td>
                              </tr>
                              <tr className="text-[10px] text-green-700">
                                <td>MOVIMIENTOS DE CAJA (+) — INGRESOS USD:</td>
                                <td className="text-right">$ {formatUsd(entradasUsd)}</td>
                              </tr>
                              <tr className="text-[10px] text-red-600">
                                <td>MOVIMIENTOS DE CAJA (-) — EGRESOS BS:</td>
                                <td className="text-right">({formatBs(egresosBs)})</td>
                              </tr>
                              <tr className="text-[10px] text-red-600">
                                <td>MOVIMIENTOS DE CAJA (-) — EGRESOS USD:</td>
                                <td className="text-right">($ {formatUsd(egresosUsd)})</td>
                              </tr>
                            </tbody></table>
                          );
                        })()}

                        <div className="separator-dashed"></div>
                        <div className="text-center font-bold">COBROS DE DEUDAS</div>
                        <div className="separator-dashed"></div>
                        <table><tbody>
                          <tr className="bold">
                            <td>TOTAL USD POR COBRO DE DEUDAS:</td>
                            <td className="text-right">$ {formatUsd(data.cobrosDeudaUSD ?? data.cobrosDeudaUsd ?? 0)}</td>
                          </tr>
                        </tbody></table>
                        <div className="separator-dashed"></div>
                        <div className="text-center font-bold">TOTAL NETO EFECTIVO FÍSICO</div>
                        <div className="separator-dashed"></div>
                        <table><tbody>
                          <tr className="bold">
                            <td>TOTAL NETO EFECTIVO BS (FÍSICOS):</td>
                            <td className="text-right">{formatBs(Number(data.totalNetoEfectivoBS) || 0)}</td>
                          </tr>
                          <tr className="bold">
                            <td>TOTAL NETO EFECTIVO USD (FÍSICOS):</td>
                            <td className="text-right">$ {formatUsd(Number(data.totalNetoEfectivoUSD) || 0)}</td>
                          </tr>
                        </tbody></table>


                        <div className="separator-dashed"></div>
                        <div className="text-center font-bold">CIERRE DE JORNADA EXITOSO</div>
                     </>
                   )}
                   {type === 'REPORT_X' && (
                     <div className="text-center font-bold mt-2">DOCUMENTO NO VÁLIDO COMO<br/>CIERRE FISCAL</div>
                   )}
                </div>
              ))}

              {/* CONTENIDO VENTA (RECIBO) */}
              {!isReport && (
                <div className="space-y-1">
                   <table>
                     <thead className="bold"><tr><td>CANT</td><td>DESCRIPCIÓN</td><td className="text-right">TOTAL</td></tr></thead>
                     <tbody>
                       {getItems().map((it: any, i: number) => (
                         <tr key={i}>
                           <td>{it.cantidad || it.qty}</td>
                           <td className="text-[10px]">{it.nombre?.toUpperCase().substring(0, 24)}</td>
                           <td className="text-right">${formatUsd(it.subtotalUSD || (it.precioUnitUSD * it.cantidad)).replace('$','')}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                   <div className="separator-solid"></div>
                   <table><tbody>
                     <tr className="bold text-[14px]"><td>TOTAL A PAGAR ($):</td><td className="text-right">${formatUsd(totalUsd).replace('$','')}</td></tr>
                     <tr className="bold"><td>TOTAL EN Bs.:</td><td className="text-right">{formatBs(totalBs)}</td></tr>
                   </tbody></table>
                   <div className="separator-dashed"></div>
                   
                   {/* ===== DESGLOSE DE PAGOS EN RECIBO ===== */}
                   <div className="text-center font-bold">FORMA DE PAGO</div>
                   {(() => {
                     const pays = data.payments || [];
                     return (
                       <table><tbody>
                         {pays.length > 0 ? pays.map((p: any, i: number) => {
                           const isUsd = isUsdPayment(p.metodo);
                           const amount = p.montoUSD || p.monto || 0;
                           return (
                             <tr key={i}>
                               <td>{Utils.metodoLabel(p.metodo).toUpperCase()}:</td>
                               <td className="text-right">{isUsd ? `$ ${formatUsd(amount).replace('$','')}` : formatBs(p.montoBS || (amount * state.tasa))}</td>
                             </tr>
                           );
                         }) : (
                           <tr>
                             <td>{Utils.metodoLabel(data.metodoPago).toUpperCase()}:</td>
                             <td className="text-right">${formatUsd(totalUsd).replace('$','')}</td>
                           </tr>
                         )}
                         {data.change > 0 && <tr><td>SU VUELTO Bs.:</td><td className="text-right">{formatBs(data.change)}</td></tr>}
                         <tr><td colSpan={2} className="text-center text-[9px] mt-1">(Tasa Ref: {state.tasa.toFixed(2)} Bs/USD)</td></tr>
                       </tbody></table>
                     );
                   })()}
                   <div className="text-center mt-4 bold">¡GRACIAS POR SU COMPRA!</div>
                </div>
              )}

              <div className="text-center text-[9px] mt-4 opacity-60 uppercase tracking-tighter">PosVEN Pro v2.5.7 - Soluciones Digitales</div>
            </div>
          </div>

          <div className={type === 'REPORT_X' ? "p-4 bg-white border-t border-gray-100 grid grid-cols-4 gap-3 shrink-0" : "p-4 bg-white border-t border-gray-100 grid grid-cols-2 gap-3"}>
             <button onClick={onClose} className="py-3 bg-gray-200 text-ink font-black text-xs rounded-xl uppercase">Cerrar</button>
             {type === 'REPORT_X' ? (
               <>
                 <button onClick={handlePrint} className="py-3 bg-brand-gold text-black font-black text-xs rounded-xl flex items-center justify-center gap-2 uppercase shadow-lg">
                   <Printer size={14} /> Imprimir PC
                 </button>
                 <button onClick={() => { void handleShareArqueoPdf(); }} className="py-3 bg-ink text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 uppercase shadow-lg">
                   <Share2 size={14} /> Compartir PDF
                 </button>
                 <button onClick={() => { void handleDownloadArqueoPdf(); }} className="py-3 bg-white border-2 border-ink text-ink font-black text-xs rounded-xl flex items-center justify-center gap-2 uppercase">
                   <Monitor size={14} /> Descargar PDF
                 </button>
               </>
             ) : (
               <button onClick={handleNativePrint} className="py-3 bg-brand-gold text-black font-black text-xs rounded-xl flex items-center justify-center gap-2 uppercase shadow-lg">
                  <Zap size={14} className="fill-current" /> Impresión 80mm
               </button>
             )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}