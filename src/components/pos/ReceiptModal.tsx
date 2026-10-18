"use client";

import React, { useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, X, Zap, Share2, Monitor } from 'lucide-react';
import { Store, Utils } from '@/lib/db-store';
import { formatBs, formatUsd } from '@/lib/currency-formatter';
import { auth } from '@/lib/firebase';

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
    if (type === 'REPORT_X') return '*** REPORTE X - ARQUEO ***';
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
    const currentUser = auth.currentUser;
    if (currentUser) {
      return currentUser.displayName || currentUser.email || 'Administrador';
    }
    return 'Administrador';
  }, [data.cajeroNombre, data.cajero, data.cashier]);

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

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Impresion_PosVEN_Pro</title>
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
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
              setTimeout(function() { window.close(); }, 1500);
            };
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(onClose, 1000);
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
      <DialogContent className="sm:max-w-[440px] p-0 bg-transparent border-none overflow-hidden shadow-none">
        <DialogHeader className="sr-only"><DialogTitle>Impresión Térmica Font A</DialogTitle></DialogHeader>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-200">
          <div className="bg-black p-4 flex justify-between items-center">
            <h3 className="text-white font-black text-xs flex items-center gap-2 tracking-widest uppercase">
              <Printer size={16} className="text-brand-gold" /> VISTA PREVIA (42C)
            </h3>
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={20} /></button>
          </div>

          <div className="p-6 bg-gray-100 flex justify-center max-h-[70vh] overflow-y-auto custom-scrollbar">
            <div 
              ref={printRef}
              className="bg-white p-6 shadow-sm text-black font-mono select-none"
              style={{ width: '72mm', boxSizing: 'border-box', color: '#000', fontSize: '12px', lineHeight: '1.2' }}
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
              {isReport && (
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

                   {/* ===== MOVIMIENTO DE CAJA CORREGIDO - INCLUYE COBROS DE DEUDA ===== */}
                   <div className="text-center font-bold">MOVIMIENTO DE CAJA</div>
                   <div className="separator-dashed"></div>
                   {(() => {
                     const fondoBs = data.fondoAperturaBS || data.fondoAperturaBs || 0;
                     const fondoUsd = data.fondoAperturaUSD || data.fondoAperturaUsd || 0;
                     
                     // Calcular ventas en efectivo desde los métodos de pago
                     let ventasEfectivoBs = 0;
                     let ventasEfectivoUsd = 0;
                     const paymentMethods = getPaymentMethods();
                     
                     if (Object.keys(paymentMethods).length > 0) {
                       if (Array.isArray(paymentMethods)) {
                         paymentMethods.forEach((p: any) => {
                           const method = p.metodo || p.method || 'efectivo';
                           const amountUSD = p.montoUSD || p.amountUSD || p.monto || p.amount || 0;
                           const amountBS = p.montoBS || p.amountBS || (amountUSD * state.tasa) || 0;
                           const isUsd = isUsdPayment(method);
                           
                           if (method === 'efectivo_bs' || (method === 'efectivo' && !isUsd)) {
                             ventasEfectivoBs += amountBS;
                           } else if (method === 'efectivo_usd' || isUsd) {
                             ventasEfectivoUsd += amountUSD;
                           }
                         });
                       } else {
                         Object.entries(paymentMethods).forEach(([method, amount]) => {
                           const amountNum = typeof amount === 'number' ? amount : 0;
                           const amountUSD = amountNum;
                           const amountBS = amountNum * state.tasa;
                           const isUsd = isUsdPayment(method);
                           
                           if (method === 'efectivo_bs' || (method === 'efectivo' && !isUsd)) {
                             ventasEfectivoBs += amountBS;
                           } else if (method === 'efectivo_usd' || isUsd) {
                             ventasEfectivoUsd += amountUSD;
                           }
                         });
                       }
                     }
                     
                     // ===== INCLUIR COBROS DE DEUDA EN EFECTIVO =====
                     const cobrosDeudaBs = data.cobrosDeudaBs || data.cobrosDeudaBS || 0;
                     const cobrosDeudaUsd = data.cobrosDeudaUsd || data.cobrosDeudaUSD || 0;
                     
                     // Sumar cobros de deuda a las ventas en efectivo
                     const totalVentasEfectivoBs = ventasEfectivoBs + cobrosDeudaBs;
                     const totalVentasEfectivoUsd = ventasEfectivoUsd + cobrosDeudaUsd;
                     
                     return (
                       <table><tbody>
                         <tr><td>FONDO APERTURA Bs.:</td><td className="text-right">{formatBs(fondoBs)}</td></tr>
                         <tr><td>FONDO APERTURA USD:</td><td className="text-right">$ {formatUsd(fondoUsd)}</td></tr>
                         <tr><td>VENTAS EFECTIVO Bs.:</td><td className="text-right">{formatBs(totalVentasEfectivoBs)}</td></tr>
                         <tr><td>VENTAS EFECTIVO USD:</td><td className="text-right">$ {formatUsd(totalVentasEfectivoUsd)}</td></tr>
                         {cobrosDeudaBs > 0 && (
                           <tr className="text-[10px] text-gray-600">
                             <td>└ COBROS DE DEUDA Bs.:</td>
                             <td className="text-right">{formatBs(cobrosDeudaBs)}</td>
                           </tr>
                         )}
                         {cobrosDeudaUsd > 0 && (
                           <tr className="text-[10px] text-gray-600">
                             <td>└ COBROS DE DEUDA USD:</td>
                             <td className="text-right">$ {formatUsd(cobrosDeudaUsd)}</td>
                           </tr>
                         )}
                         <tr className="bold"><td>TOTAL ESTIMADO Bs.:</td><td className="text-right">{formatBs(fondoBs + totalVentasEfectivoBs)}</td></tr>
                         <tr className="bold"><td>TOTAL ESTIMADO USD:</td><td className="text-right">$ {formatUsd(fondoUsd + totalVentasEfectivoUsd)}</td></tr>
                       </tbody></table>
                     );
                   })()}

                   <div className="separator-dashed"></div>
                   {type === 'REPORT_Z' && (
                     <>
                        <div className="text-center font-bold">TOTALES HISTÓRICOS</div>
                        <div className="text-center text-[10px]">(ACUMULADO NO REINICIABLE)</div>
                        <table><tbody>
                          <tr><td>GRAN TOTAL VENTAS:</td><td className="text-right">{formatBs(data.acumuladoHistoricoUSD * state.tasa)}</td></tr>
                        </tbody></table>
                        <div className="separator-solid"></div>
                        <div className="text-center font-bold">CIERRE DE JORNADA EXITOSO</div>
                     </>
                   )}
                   {type === 'REPORT_X' && (
                     <div className="text-center font-bold mt-2">DOCUMENTO NO VÁLIDO COMO<br/>CIERRE FISCAL</div>
                   )}
                </div>
              )}

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

          <div className="p-4 bg-white border-t border-gray-100 grid grid-cols-2 gap-3">
             <button onClick={onClose} className="py-3 bg-gray-200 text-ink font-black text-xs rounded-xl uppercase">Cerrar</button>
             <button onClick={handleNativePrint} className="py-3 bg-brand-gold text-black font-black text-xs rounded-xl flex items-center justify-center gap-2 uppercase shadow-lg">
                <Zap size={14} className="fill-current" /> Impresión 80mm
             </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}