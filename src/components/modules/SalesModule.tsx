"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Receipt, 
  Barcode, 
  Wallet, 
  X, 
  CheckCircle2, 
  FileText,
  History,
  ClipboardList,
  ArrowLeft,
  Eye,
  Clock,
  Printer,
  Zap,
  Share2,
  UserPlus,
  User,
  AlertTriangle,
  Undo2,
  Lock,
  RefreshCw,
  Check,
  RotateCcw,
  HandCoins,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  TrendingUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Contact,
  Maximize2,
  Minimize2,
  Tag,
  Loader2,
  Hash
} from 'lucide-react';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { CreditModal } from '@/components/pos/CreditSaleModal';
import FloatingPaymentModal from '@/components/pos/FloatingPaymentModal';
import { toast } from '@/hooks/use-toast';
import { AppState, SaleItem, Sale, PaymentMethod, ReportZ, PagoRealizado, Customer, Return, ReturnItem, Product, Debt, Movimiento, LibroDiarioEntry } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import ReturnsModule from '@/components/modules/ReturnsModule';
import { Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/utils';
import CashZArqueoModal from '@/components/pos/CashZArqueoModal';
import ZReportPreview80mm from '@/components/pos/ZReportPreview80mm';

// ============================================================
// UTILIDADES DE NORMALIZACIÓN DE CÉDULA (integradas)
// ============================================================

/**
 * Normaliza una cédula según el tipo de documento
 * - Para V- y E-: formato con puntos (XX.XXX.XXX)
 * - Para J-, G-, P-: solo dígitos sin formato
 */
function normalizeCedula(cedula: string, docType?: string): string {
  if (!cedula) return '';
  
  let type = docType || '';
  let number = cedula;
  
  const match = cedula.match(/^([A-Z]-?)?(.*)/);
  if (match) {
    if (match[1] && !docType) {
      type = match[1].replace('-', '').trim() + '-';
    }
    number = match[2] || '';
  }
  
  const cleanNumber = number.replace(/[^0-9]/g, '');
  
  if (!type) type = 'V-';
  
  if (type === 'V-' || type === 'E-') {
    const digits = cleanNumber;
    if (digits.length <= 2) return `${type}${digits}`;
    if (digits.length <= 5) return `${type}${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}`;
  }
  
  return `${type}${cleanNumber}`;
}

/**
 * Obtiene solo el número de cédula sin puntos ni tipo
 */
function getRawCedula(cedula: string): string {
  if (!cedula) return '';
  return cedula.replace(/[^0-9]/g, '');
}

/**
 * Busca un cliente por cédula normalizada, ignorando formato
 */
function findCustomerByCedula(customers: any[], cedula: string): any | null {
  const raw = getRawCedula(cedula);
  if (!raw || raw.length === 0) return null;
  return customers.find(c => {
    const cRaw = getRawCedula(c?.cedula || '');
    return cRaw.length > 0 && cRaw === raw;
  }) || null;
}

/**
 * Busca deudas por cédula del cliente (en el campo cliente)
 */
function findDebtsByCedula(deudas: any[], cedula: string): any[] {
  const raw = getRawCedula(cedula);
  if (!raw || raw.length === 0) return [];
  return deudas.filter(d => {
    if (!d.cliente) return false;
    const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
    if (match && match[2]) {
      const dRaw = getRawCedula(match[2]);
      return dRaw.length > 0 && dRaw === raw;
    }
    return false;
  });
}

/**
 * Extrae el tipo de documento (V-, J-, etc.) de una cédula
 */
function extractDocType(cedula: string): string {
  const match = cedula.match(/^([A-Z]-?)/);
  return match ? match[1].replace('-', '').trim() + '-' : 'V-';
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export default function SalesModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'pos' | 'history' | 'credits' | 'returns'>('pos');
  const [histPage, setHistPage] = useState(1);
  const [showReportType, setShowReportType] = useState<'REPORT_X' | 'REPORT_Z' | null>(null);
  const [reportSnapshot, setReportSnapshot] = useState<any>(null);
  const [reportLoadingType, setReportLoadingType] = useState<'REPORT_X' | 'REPORT_Z' | null>(null);
  const [showZArqueo, setShowZArqueo] = useState(false);
  const [globalCreditCustomer, setGlobalCreditCustomer] = useState<{ name: string; cedula?: string; totalUSD: number; totalBS: number } | null>(null);
  const [cliente, setCliente] = useState('Consumidor final');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [pagos, setPagos] = useState<PagoRealizado[]>([]);
  const [showMultiModal, setShowMultiModal] = useState(false);
  
  const [showAbonoModal, setShowAbonoModal] = useState<Debt | null>(null);
  
  const [showDetails, setShowDetails] = useState<any | null>(null);
  const [showSaleDetail, setShowSaleDetail] = useState<any | null>(null);
  const [lastProcessedSale, setLastProcessedSale] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedProductDisplay, setSelectedProductDisplay] = useState<Product | null>(null);
  const [stockEdit, setStockEdit] = useState<Product | null>(null);
  const [stockEditValue, setStockEditValue] = useState('');
  
  const [priceSelectorItem, setPriceSelectorItem] = useState<{ index: number, product: Product } | null>(null);

  // ===== ESTADOS PARA CREDIT MODAL =====
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [showCashMovementModal, setShowCashMovementModal] = useState(false);
  const [cashMovement, setCashMovement] = useState<{
    tipo: 'ingreso' | 'egreso';
    metodo: 'efectivo_bs' | 'efectivo_usd';
    monto: string;
    concepto: string;
    observacion: string;
  }>({
    tipo: 'egreso',
    metodo: 'efectivo_usd',
    monto: '',
    concepto: '',
    observacion: ''
  });
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Customer | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', tipoDoc: 'V', cedula: '', phone: '', address: '' });

  const [editandoTasa, setEditandoTasa] = useState(false);
  const [nuevaTasa, setNuevaTasa] = useState(state.tasa.toString());

  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showClientHistory, setShowClientHistory] = useState<string | null>(null);
  const [creditSearch, setCreditSearch] = useState('');

  // Historial completo de CxC usado EXCLUSIVAMENTE por Consultar Créditos.
  // No depende del cache reducido que se carga al iniciar el POS.
  const [creditDebts, setCreditDebts] = useState<Debt[]>(state.cxc || []);

  useEffect(() => {
    if (view !== 'credits') return;
    let cancelled = false;
    (async () => {
      try {
        const pageSize = 2000;
        const allRecords: any[] = [];
        for (let offset = 0; ; offset += pageSize) {
          const response = await fetch(
            '/api/turso/store?table=cxc&limit=' + pageSize + '&offset=' + offset,
            { credentials: 'include', cache: 'no-store' }
          );
          const body: any = await response.json();
          if (!response.ok || body?.ok === false) {
            throw new Error(String(body?.error || 'Turso rechazó la lectura histórica de CxC.'));
          }
          const page = Array.isArray(body?.records) ? body.records : [];
          allRecords.push(...page);
          if (page.length < pageSize) break;
        }
        if (!cancelled) setCreditDebts(allRecords as Debt[]);
      } catch (e) {
        console.error('[POS Ventas] No se pudo cargar el histórico completo de CxC:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    setHistPage(1);
    if (view !== 'credits') setCreditSearch('');
  }, [view]);

  const currentTerminal = useMemo(() => {
    const appUser: any = (state as any).user || null;
    const explicitTerminalId = String(appUser?.terminalId || '').trim();
    if (explicitTerminalId) {
      return state.terminales.find(t => String(t.id) === explicitTerminalId) || null;
    }
    const ids = [appUser?.id, appUser?.uid].filter(Boolean).map(String);
    return ids.length
      ? state.terminales.find(t => ids.includes(String(t.usuarioId || ''))) || null
      : null;
  }, [state.terminales, (state as any).user]);

  const histVentas = useMemo(() => {
    const tc = Utils.getTerminalCash(currentTerminal);
    const desde = tc.fechaUltimoZ || '';
    const ventas = (state.ventas || [])
      .filter(v => v.terminalId === currentTerminal?.id && v.fecha > desde)
      .map(v => ({ ...v, esMovimientoCaja: false }));
    const movimientos = (state.libroDiario || [])
      .filter(e => e.terminalId === currentTerminal?.id && e.fecha > desde && e.categoria === 'MOVIMIENTO_CAJA')
      .map(e => ({
        id: e.id,
        fecha: e.fecha,
        cliente: e.concepto || e.descripcion || e.motivo || 'MOVIMIENTO DE CAJA',
        concepto: e.concepto || e.descripcion || e.motivo || 'MOVIMIENTO DE CAJA',
        observacion: e.observacion || e.nota || '',
        items: [],
        subtotalUSD: e.montoUSD,
        descuentoUSD: 0,
        totalUSD: e.montoUSD,
        totalBS: e.montoBS,
        metodoPago: e.metodo,
        estado: e.tipo,
        type: 'MOVIMIENTO CAJA',
        terminalId: e.terminalId,
        terminalName: e.terminalName,
        esMovimientoCaja: true
      } as any));
    return [...ventas, ...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [state.ventas, state.libroDiario, currentTerminal?.id]);

  const histPageSize = 10;
  const histTotalPages = Math.max(1, Math.ceil(histVentas.length / histPageSize));
  const histSafePage = Math.min(histPage, histTotalPages);
  const histPageVentas = histVentas.slice((histSafePage - 1) * histPageSize, histSafePage * histPageSize);

  const getSaleCurrencyTotals = (v: any) => {
    const rate = Number(v?.tasaAplicada || v?.tasa || state.tasa || 1) || 1;
    const pays = Array.isArray(v?.payments) && v.payments.length
      ? v.payments
      : [{ metodo: v?.metodoPago || 'otros', montoUSD: v?.totalUSD || 0, montoBS: v?.totalBS }];
    let usd = 0;
    let bs = 0;
    pays.forEach((p:any) => {
      const method = String(p?.metodo || p?.method || '').toLowerCase();
      const pUsd = Number(p?.montoUSD) || Number(p?.usdAmount) || (
        ['efectivo_bs','pagomovil','punto_venta','biopago','transferencia'].includes(method)
          ? (Number(p?.amount) || Number(p?.totalBS) || 0) / rate
          : 0
      );
      const pBs = Number(p?.montoBS) || Number(p?.totalBS) || (
        Number(p?.amount) || (
          ['efectivo_usd','zelle'].includes(method) ? pUsd * rate : 0
        )
      );
      usd += pUsd;
      bs += pBs;
    });
    return { usd, bs };
  };

  const getFreshReportData = () => {
    const freshState = Store.get();

    // El terminal que ya resolvió la pantalla POS es la fuente de verdad para
    // X/Z. Nunca permitimos que un usuario cacheado de Store.get() cambie de
    // caja el reporte (p.ej. Rosmary/Barra 2 -> Newman/Barra 3).
    const activeTerminalId = String(currentTerminal?.id || '').trim();
    const resolvedTerminal =
      (activeTerminalId
        ? (freshState.terminales || []).find((t:any) => String(t?.id || '') === activeTerminalId)
        : null) || currentTerminal;
    const termId = String(resolvedTerminal?.id || activeTerminalId || '').trim();

    // El cajero queda ligado a la caja activa. Para la sesión normal, el usuario
    // actual debe coincidir con el usuario asignado al terminal.
    const sessionUser: any = (state as any).user || null;
    const assignedUserId = String(resolvedTerminal?.usuarioId || '').trim();
    const sessionUserIds = [sessionUser?.uid, sessionUser?.id].filter(Boolean).map(String);
    const cajeroNombre =
      assignedUserId && sessionUserIds.includes(assignedUserId)
        ? String(sessionUser?.nombre || sessionUser?.name || sessionUser?.displayName || sessionUser?.email || 'Cajero')
        : String(sessionUser?.nombre || sessionUser?.name || sessionUser?.displayName || sessionUser?.email || 'Cajero');
    const tc = Utils.getTerminalCash(resolvedTerminal);
    const corteTimestamp = tc.fechaUltimoZ || freshState.fechaUltimoZ || '';

    const allVentas = freshState.ventas || [];
    const allDevoluciones = freshState.devoluciones || [];
    const allAnulaciones = freshState.anulaciones || [];
    const allLibroDiario = freshState.libroDiario || [];
    const inWindow = (fecha:string) => fecha > corteTimestamp;

    const esCobroDeuda = (v:any) => {
      const tipo = String(v?.type || '').trim().toUpperCase();
      return tipo === 'COBRO DEUDA' || tipo === 'ABONO DEUDA' || tipo === 'COBRO_DEUDA';
    };
    const vActivas = allVentas.filter(v => inWindow(v.fecha) && v.estado !== 'anulada' && String(v.terminalId || '') === termId && !esCobroDeuda(v));
    const vAnuladas = allVentas.filter(v => inWindow(v.fecha) && v.estado === 'anulada' && String(v.terminalId || '') === termId && !esCobroDeuda(v));
    const dHoy = allDevoluciones.filter(d => inWindow(d.fecha) && String(allVentas.find(v => v.id === d.ventaId)?.terminalId || '') === termId);
    const aHoy = allAnulaciones.filter(a => inWindow(a.fecha) && String(allVentas.find(v => v.id === a.ventaId)?.terminalId || '') === termId);

    const brUSD = vActivas.reduce((s,v) => s + (Number(v.totalUSD)||0), 0);
    const devUSD = dHoy.reduce((s,d) => s + (Number(d.totalUSD)||0), 0) + aHoy.reduce((s,a) => s + (Number(a.totalUSD)||0), 0);
    const descUSD = vActivas.reduce((s,v) => s + (Number(v.descuentoUSD)||0), 0);
    const netUSD = brUSD - devUSD - descUSD;
    const baseImponibleUSD = vActivas.reduce((s,v) => s + (Number(v.baseImponibleUSD)||0), 0);
    const ivaUSD = vActivas.reduce((s,v) => s + (Number(v.ivaUSD)||0), 0);
    const exentoUSD = vActivas.reduce((s,v) => s + (Number(v.exentoUSD)||0), 0);
    const igtfUSD = vActivas.reduce((s,v) => s + (Number(v.igtfUSD)||0), 0);

    const paymentMethodsMap: Record<string, number> = {};
    vActivas.forEach(v => (Array.isArray(v.payments) && v.payments.length ? v.payments : [{metodo:v.metodoPago||'otros',montoUSD:v.totalUSD}]).forEach((p:any) => {
      const m=String(p.metodo||'otros');
      paymentMethodsMap[m]=(paymentMethodsMap[m]||0)+(Number(p.montoUSD)||Number(p.usdAmount)||0);
    }));

    const sortedVentas=[...vActivas].sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const sortedDevs=[...dHoy].sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const desdeFactura=sortedVentas[0]?.id||'N/A';
    const hastaFactura=sortedVentas[sortedVentas.length-1]?.id||'N/A';
    const desdeNC=sortedDevs[0]?.id||'N/A';
    const hastaNC=sortedDevs[sortedDevs.length-1]?.id||'N/A';

    // Todos los métodos se normalizan antes de alimentar el arqueo. Esto evita
    // que TARJETA/PUNTO DE VENTA terminen en filas distintas.
    const normalizarMetodo=(m:any)=>{
      const base=String(m||'otros').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
      if (['punto_venta','punto_de_venta','punto_pago','punto_de_pago','tarjeta_debito','tarjeta_credito'].includes(base)) return 'tarjeta';
      if (base==='pago_movil') return 'pagomovil';
      return base;
    };
    const esMetodoUSD=(m:string)=>['efectivo_usd','zelle','usd','dolar','dolares'].includes(normalizarMetodo(m));
    const esMetodoBS=(m:string)=>['efectivo_bs','efectivo','bs','bolivares','tarjeta','pagomovil','biopago','transferencia'].includes(normalizarMetodo(m));
    const addPaymentTo=(p:any,factor=1)=>{
      const metodo=normalizarMetodo(p?.metodo||p?.method||'otros');
      const usd=Number(p?.montoUSD??p?.usdAmount??0)||0;
      const bs=Number(p?.montoBS??p?.amountBS??p?.totalBS??0)||(
        esMetodoBS(metodo) ? (Number(p?.amount)||0) :
        esMetodoUSD(metodo) ? 0 : 0
      );
      return {metodo,usd:usd*factor,bs:bs*factor};
    };
    const relevantDiario=allLibroDiario.filter(e=>inWindow(e.fecha)&&String(e.terminalId||'')===termId);
    const totalSalidasCaja=relevantDiario.filter(e=>e.tipo==='egreso').reduce((s,e)=>s+(Number(e.montoUSD)||0),0);
    const totalEntradasCaja=relevantDiario.filter(e=>e.tipo==='ingreso'&&e.categoria!=='VENTA'&&e.categoria!=='COBRO_DEUDA').reduce((s,e)=>s+(Number(e.montoUSD)||0),0);
    const esMovimientoCaja=(e:any)=>{
      const categoria=String(e?.categoria||'').trim().toUpperCase().replace(/Á/g,'A');
      return categoria==='MOVIMIENTO_CAJA' || categoria==='MOVIMIENTO DE CAJA' || String(e?.type||'').toUpperCase()==='MOVIMIENTO CAJA';
    };
    const movimientosCaja=relevantDiario.filter((e:any)=>
      esMovimientoCaja(e) &&
      (e.tipo==='ingreso'||e.tipo==='egreso')
    );
    const totalSalidasCajaBS=movimientosCaja.filter(e=>e.tipo==='egreso'&&normalizarMetodo(e.metodo)==='efectivo_bs').reduce((s,e)=>s+(Number(e.montoBS)||0),0);
    const totalSalidasCajaUSD=movimientosCaja.filter(e=>e.tipo==='egreso'&&normalizarMetodo(e.metodo)==='efectivo_usd').reduce((s,e)=>s+(Number(e.montoUSD)||0),0);
    const totalEntradasCajaBS=movimientosCaja.filter(e=>e.tipo==='ingreso'&&normalizarMetodo(e.metodo)==='efectivo_bs').reduce((s,e)=>s+(Number(e.montoBS)||0),0);
    const totalEntradasCajaUSD=movimientosCaja.filter(e=>e.tipo==='ingreso'&&normalizarMetodo(e.metodo)==='efectivo_usd').reduce((s,e)=>s+(Number(e.montoUSD)||0),0);

    const arqueoMap:Record<string,any>={};
    const ensureArqueo=(metodo:string)=>{
      if(!arqueoMap[metodo]) arqueoMap[metodo]={ventasBS:0,ventasUSD:0,cobrosBS:0,cobrosUSD:0,devBS:0,devUSD:0,movPlusBS:0,movPlusUSD:0,movMinusBS:0,movMinusUSD:0};
      return arqueoMap[metodo];
    };

    vActivas.forEach(v=>{
      const pays=Array.isArray(v.payments)&&v.payments.length?v.payments:[{metodo:v.metodoPago||'otros',montoUSD:v.totalUSD,montoBS:v.totalBS,tasaAplicada:v.tasaAplicada}];
      pays.forEach((p:any)=>{const x=addPaymentTo(p);if(x.metodo==='credito')return;const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.ventasUSD+=x.usd;else row.ventasBS+=x.bs;});
    });

    const cobroDeudaVentas=allVentas.filter(v=>inWindow(v.fecha)&&String(v.terminalId||'')===termId&&esCobroDeuda(v));
    cobroDeudaVentas.forEach(v=>{
      const pays=Array.isArray(v.payments)&&v.payments.length?v.payments:[{metodo:v.metodoPago||'otros',montoUSD:v.totalUSD,montoBS:v.totalBS,tasaAplicada:v.tasaAplicada}];
      pays.forEach((p:any)=>{const x=addPaymentTo(p);const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.cobrosUSD+=x.usd;else row.cobrosBS+=x.bs;});
    });

    // Las anulaciones/devoluciones descuentan del método REAL utilizado para el reintegro.
    // Se prioriza refundPayments (nuevo formato); los documentos históricos usan el método de venta como fallback.
    aHoy.forEach((a:any)=>{
      const sale:any=allVentas.find(v=>v.id===a.ventaId);
      const pays=Array.isArray(a.refundPayments)&&a.refundPayments.length
        ? a.refundPayments
        : (sale&&Array.isArray(sale.payments)&&sale.payments.length
          ? sale.payments
          : [{metodo:sale?.metodoPago||'otros',montoUSD:a.totalUSD,montoBS:sale?.totalBS,tasaAplicada:sale?.tasaAplicada}]);
      pays.forEach((p:any)=>{const x=addPaymentTo(p);const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.devUSD+=x.usd;else row.devBS+=x.bs;});
    });

    // Evita duplicar anulaciones históricas que todavía no tienen documento en anulaciones.
    const anulacionIds=new Set(aHoy.map((a:any)=>String(a.ventaId||'')));
    vAnuladas.filter(v=>!anulacionIds.has(String(v.id))).forEach(v=>{
      const pays=Array.isArray(v.payments)&&v.payments.length?v.payments:[{metodo:v.metodoPago||'otros',montoUSD:v.totalUSD,montoBS:v.totalBS,tasaAplicada:v.tasaAplicada}];
      pays.forEach((p:any)=>{const x=addPaymentTo(p);const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.devUSD+=x.usd;else row.devBS+=x.bs;});
    });

    dHoy.forEach(d=>{
      const sale:any=allVentas.find(v=>v.id===d.ventaId);
      const pays=Array.isArray(d.refundPayments)&&d.refundPayments.length
        ? d.refundPayments
        : (sale&&Array.isArray(sale.payments)&&sale.payments.length
          ? sale.payments
          : [{metodo:sale?.metodoPago||'otros',montoUSD:d.totalUSD,montoBS:(Number(d.totalUSD)||0)*(Number(freshState.tasa)||1),tasaAplicada:sale?.tasaAplicada}]);
      if (Array.isArray(d.refundPayments)&&d.refundPayments.length) {
        pays.forEach((p:any)=>{const x=addPaymentTo(p);const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.devUSD+=x.usd;else row.devBS+=x.bs;});
      } else {
        const saleTotal=Math.max(Number(sale?.totalUSD)||0.000001,0.000001);
        pays.forEach((p:any)=>{const x=addPaymentTo(p,(Number(d.totalUSD)||0)/saleTotal);const row=ensureArqueo(x.metodo);if(esMetodoUSD(x.metodo))row.devUSD+=x.usd;else row.devBS+=x.bs;});
      }
    });

    movimientosCaja.forEach((e:any)=>{
      const metodo=normalizarMetodo(e?.metodo||'otros');
      const row=ensureArqueo(metodo);
      const montoUSD=Number(e?.montoUSD)||0;
      const montoBS=Number(e?.montoBS)||0;
      if(e.tipo==='ingreso'){
        if(esMetodoUSD(metodo)) row.movPlusUSD+=montoUSD;
        else if(esMetodoBS(metodo)) row.movPlusBS+=montoBS;
      } else if(e.tipo==='egreso'){
        if(esMetodoUSD(metodo)) row.movMinusUSD+=montoUSD;
        else if(esMetodoBS(metodo)) row.movMinusBS+=montoBS;
      }
    });

    const metodosArqueo=Object.entries(arqueoMap).map(([metodo,val]:any)=>({metodo,...val,moneda:esMetodoUSD(metodo)?'USD':esMetodoBS(metodo)?'BS':'USD'}));
    const ventasCreditoUSD=vActivas.filter(v=>String(v.metodoPago||'').toLowerCase()==='credito'||(Array.isArray(v.payments)&&v.payments.some((p:any)=>p.metodo==='credito'))).reduce((s,v)=>s+(Number(v.totalUSD)||0),0);
    const cobrosDeudaUSD=cobroDeudaVentas.reduce((s,v)=>s+getSaleCurrencyTotals(v).usd,0);
    const cobrosDeudaBS=cobroDeudaVentas.reduce((s,v)=>s+getSaleCurrencyTotals(v).bs,0);
    const cobrosDeudaPorMetodoMap: Record<string, { metodo:string; montoBS:number; montoUSD:number }> = {};
    cobroDeudaVentas.forEach((v:any) => {
      const pays = Array.isArray(v.payments) && v.payments.length
        ? v.payments
        : [{ metodo:v.metodoPago || 'otros', montoUSD:v.totalUSD, montoBS:v.totalBS }];
      pays.forEach((p:any) => {
        const metodo = normalizarMetodo(p?.metodo || p?.method || 'otros');
        const key = metodo;
        if (!cobrosDeudaPorMetodoMap[key]) cobrosDeudaPorMetodoMap[key] = { metodo, montoBS:0, montoUSD:0 };
        const x = addPaymentTo(p);
        cobrosDeudaPorMetodoMap[key].montoBS += x.bs;
        cobrosDeudaPorMetodoMap[key].montoUSD += x.usd;
      });
    });
    const cobrosDeudaPorMetodo = Object.values(cobrosDeudaPorMetodoMap);

    // Neto físico: solo efectivo físico de la moneda original. No se convierte
    // tarjeta/Zelle/Pago Móvil/transferencia a efectivo y se incluyen apertura,
    // cobros de deuda, movimientos y devoluciones/anulaciones.
    const efectivoBS=ensureArqueo('efectivo_bs');
    const efectivoUSD=ensureArqueo('efectivo_usd');
    const fondoBS=Number(tc.fondoCajaHoyBS)||0;
    const fondoUSD=Number(tc.fondoCajaHoyUSD)||0;
    const totalNetoEfectivoBS=fondoBS+Number(efectivoBS.ventasBS||0)+Number(efectivoBS.cobrosBS||0)+Number(efectivoBS.movPlusBS||0)-Number(efectivoBS.devBS||0)-Number(efectivoBS.movMinusBS||0);
    const totalNetoEfectivoUSD=fondoUSD+Number(efectivoUSD.ventasUSD||0)+Number(efectivoUSD.cobrosUSD||0)+Number(efectivoUSD.movPlusUSD||0)-Number(efectivoUSD.devUSD||0)-Number(efectivoUSD.movMinusUSD||0);

    const terminalName=resolvedTerminal?.nombre||'CAJA NO IDENTIFICADA';

    return {brUSD,devUSD,descUSD,netUSD,igtfUSD,ivaUSD,baseImponibleUSD,exentoUSD,paymentMethods:paymentMethodsMap,cobrosDeudaPorMetodo,manualSalidas:totalSalidasCaja,manualEntradas:totalEntradasCaja,manualSalidasBS:totalSalidasCajaBS,manualSalidasUSD:totalSalidasCajaUSD,manualEntradasBS:totalEntradasCajaBS,manualEntradasUSD:totalEntradasCajaUSD,cobrosDeudaUSD,cobrosDeudaBS,fondoAperturaUSD:fondoUSD,fondoAperturaBS:fondoBS,desdeFactura,hastaFactura,desdeNC,hastaNC,stats:{facturas:vActivas.length,devoluciones:dHoy.length,anulaciones:vAnuladas.length,ticketPromedio:vActivas.length?(netUSD/vActivas.length):0},fecha:Utils.ahora(),terminalName,terminalId:termId,cajeroId:assignedUserId || sessionUser?.uid || sessionUser?.id || '',cajeroNombre,numeroZ:(tc.ultimoZ||0)+1,acumuladoHistoricoUSD:(tc.acumuladoHistorico||0)+netUSD,totalVentasUSD:brUSD,metodosArqueo,ventasCreditoUSD,devEfectivoBS:Number(efectivoBS.devBS||0),devEfectivoUSD:Number(efectivoUSD.devUSD||0),totalNetoEfectivoBS,totalNetoEfectivoUSD,estimadoEfectivoBS:{entradas:totalEntradasCajaBS,egresos:totalSalidasCajaBS,total:totalNetoEfectivoBS},estimadoEfectivoUSD:{entradas:totalEntradasCajaUSD,egresos:totalSalidasCajaUSD,total:totalNetoEfectivoUSD},tasaBCV:freshState.tasa||0};
  };

  const handleOpenReport = async (type: 'REPORT_X' | 'REPORT_Z') => {
    if (showReportType || reportLoadingType) return;
    setReportLoadingType(type);
    try {
      // Garantiza que las colecciones necesarias estén cargadas desde Firestore
      // antes de calcular el reporte. Evita el bug de reporte en $0 tras reinicio.
      await Store.ensureReportData(currentTerminal?.id || 'GLOBAL', Utils.getTerminalCash(currentTerminal).fechaUltimoZ || new Date().toISOString().split('T')[0]);
      
      // ✅ Verificar que los datos se cargaron correctamente
      const state = Store.get();
      const termId = currentTerminal?.id || 'GLOBAL';
      const ventasDelDia = (state.ventas || []).filter(v => v.estado !== 'anulada' && v.terminalId === termId);
      
      // Si no hay ventas pero la caja (de ESTE terminal) está abierta, mostrar advertencia
      if (ventasDelDia.length === 0 && Utils.getTerminalCash(currentTerminal).isCashOpen) {
        toast({ 
          variant: 'default', 
          title: 'Sin ventas registradas', 
          description: 'Las ventas aún se están sincronizando. Si el problema persiste, recarga la página.' 
        });
      }
      
      const data = getFreshReportData();
      setReportSnapshot(data);
      if (type === 'REPORT_Z') {
        setShowZArqueo(true);
      } else {
        setShowReportType(type);
      }
    } catch (e) {
      console.error('Error abriendo reporte X/Z:', e);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos del reporte. Reintenta.' });
    } finally {
      setReportLoadingType(null);
    }
  };

  const ejecutarCierreZ = (real: Record<string, string> = {}, diffOverride?: { bs: number; usd: number }) => {
    const data = reportSnapshot;
    if (!data) return;
    const ahora = Utils.ahora();
    const tc = Utils.getTerminalCash(currentTerminal);
    const numeroZ = tc.ultimoZ + 1;
    const termId = currentTerminal?.id || 'GLOBAL';
    const diff = diffOverride || { bs: 0, usd: 0 };

    // El arqueo previo sigue la misma regla de tienda-pos: cada medio de pago
    // se concilia en su moneda original y el cierre físico usa efectivo Bs/USD.
    const realBs = Number(String(real.efectivo_bs || '').replace(',', '.')) || 0;
    const realUSD = Number(String(real.efectivo_usd || '').replace(',', '.')) || 0;

    const nuevoZ: ReportZ = {
      id: 'Z-' + String(numeroZ).padStart(6, '0'),
      fecha: ahora,
      numeroZ,
      terminalId: termId,
      terminalName: data.terminalName,
      desdeFactura: data.desdeFactura,
      hastaFactura: data.hastaFactura,
      desdeNotaCredito: data.desdeNC,
      hastaNotaCredito: data.hastaNC,
      cantidadAnuladas: data.stats.anulaciones,
      ventaBrutaUSD: data.brUSD,
      descuentoUSD: data.descUSD,
      devolucionesUSD: data.devUSD,
      ventaNetaUSD: data.netUSD,
      baseImponibleUSD: data.baseImponibleUSD,
      ivaUSD: data.ivaUSD,
      exentoUSD: data.exentoUSD,
      igtfUSD: data.igtfUSD,
      metodosPago: { ...data.paymentMethods },
      metodosArqueo: Array.isArray(data.metodosArqueo) ? data.metodosArqueo.map((m:any) => ({ ...m })) : [],
      cobrosDeudaUSD: Number(data.cobrosDeudaUSD) || 0,
      cobrosDeudaBS: Number(data.cobrosDeudaBS) || 0,
      cobrosDeudaPorMetodo: Array.isArray(data.cobrosDeudaPorMetodo) ? data.cobrosDeudaPorMetodo.map((m:any) => ({ ...m })) : [],
      manualSalidasBS: Number(data.manualSalidasBS) || 0,
      manualSalidasUSD: Number(data.manualSalidasUSD) || 0,
      manualEntradasBS: Number(data.manualEntradasBS) || 0,
      manualEntradasUSD: Number(data.manualEntradasUSD) || 0,
      devEfectivoBS: Number(data.devEfectivoBS) || 0,
      devEfectivoUSD: Number(data.devEfectivoUSD) || 0,
      totalNetoEfectivoBS: realBs,
      totalNetoEfectivoUSD: realUSD,
      salidasCajaUSD: data.manualSalidas,
      entradasCajaUSD: data.manualEntradas,
      fondoAperturaUSD: data.fondoAperturaUSD,
      fondoAperturaBS: data.fondoAperturaBS,
      acumuladoHistoricoUSD: data.acumuladoHistoricoUSD,
      stats: { ...data.stats }
    };

    if (typeof localStorage !== 'undefined') localStorage.removeItem('posven_apertura_done');

    updateState({
      reportesZ: [...(state.reportesZ || []), nuevoZ],
      terminales: Utils.patchTerminal(state.terminales, termId, (() => {
        const terminal = state.terminales.find(t => t.id === termId);
        const sesion = terminal?.cashData;
        const historial = Array.isArray(terminal?.cashHistory) ? terminal.cashHistory : [];
        const cierreSesion = sesion
          ? { ...sesion, closeDate: ahora, closeNotes: 'Cierre por Corte Z ' + nuevoZ.id }
          : null;
        return {
          ultimoZ: numeroZ,
          fechaUltimoZ: ahora,
          acumuladoHistorico: data.acumuladoHistoricoUSD,
          fondoCajaHoyBS: 0,
          fondoCajaHoyUSD: 0,
          isCashOpen: false,
          cashData: null,
          cashHistory: cierreSesion ? [cierreSesion, ...historial] : historial,
        };
      })())
    });

    toast({ title: `Corte Z ${nuevoZ.id} ejecutado`, description: `Diferencia Bs. ${Utils.fmtBS(diff.bs)} · USD ${Utils.fmtUSD(diff.usd)}` });

    // Después de confirmar el arqueo, el Z NO desaparece sin comprobante:
    // se muestra inmediatamente la vista previa térmica 80mm del Reporte Z,
    // usando el mismo ReceiptModal que maneja la impresión térmica del POS.
    // Conservamos el snapshot previo para que el reporte tenga todos los
    // detalles calculados del período, y añadimos los datos definitivos del Z.
    setShowZArqueo(false);
    // Conservamos los datos de la sesión recién cerrada para la vista/impresión
    // térmica 80 mm del Z. La caja ya queda cerrada; esto es solo el comprobante
    // visual del cierre que acaba de ejecutarse.
    const session = tc.cashData;
    setReportSnapshot({
      ...data,
      ...nuevoZ,
      numeroZ: nuevoZ.numeroZ,
      empresa: state.empresa,
      generatedAt: ahora,
      closedAt: ahora,
      closedBy: data.cajeroNombre,
      openedAt: session?.openDate || session?.openedAt || session?.fechaApertura || data.openedAt,
      openedBy: session?.openedBy || session?.usuarioApertura || data.cajeroNombre,
      differenceBs: Number(diff.bs) || 0,
      differenceUSD: Number(diff.usd) || 0,
    });
    setShowReportType('REPORT_Z');
  };

  const handleOpenGlobalCreditPayment = (clientName: string, debts: Debt[]) => {
    const activeDebts = debts
      .filter(d => d.estado !== 'pagada' && (Number(d.saldoUSD) || 0) > 0.001)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
    if (activeDebts.length === 0) return;
    const totalUSD = activeDebts.reduce((sum, d) => sum + (Number(d.saldoUSD) || 0), 0);
    if (totalUSD <= 0.001) return;
    const cedulaMatch = String(activeDebts[0]?.cliente || '').match(/\[([^\]]+)\]\s*$/);
    setGlobalCreditCustomer({
      name: clientName,
      cedula: cedulaMatch?.[1]?.trim(),
      totalUSD,
      totalBS: totalUSD * state.tasa
    });
  };

  const handleProcessGlobalCreditPayment = async (payments: any[]) => {
    if (!globalCreditCustomer || isProcessing || !payments?.length) return;
    const totalUSD = payments.reduce((s, p) => s + (Number(p.usdAmount) || (Number(p.amount) || 0) / state.tasa), 0);
    const totalBS = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (totalUSD <= 0 || totalBS <= 0) return;
    setIsProcessing(true);
    try {
      const terminal = currentTerminal;
      const operationId = 'PAGO-GLOBAL-CXC-' + Store.uid();
      const receiptId = 'PEND-CXC-' + Store.uid().toUpperCase().slice(0, 8);
      const payment = {
        id: receiptId, reciboId: receiptId, fecha: Utils.ahora(),
        montoUSD: totalUSD, montoBS: totalBS,
        metodo: payments.length > 1 ? 'mixto' : payments[0].method,
        tasaAplicada: state.tasa, terminalId: terminal?.id
      };
      const paymentParts = payments.map((p: any) => ({
        id: receiptId + '-' + String(p.method || 'OTROS'),
        metodo: p.method,
        montoUSD: Number(p.usdAmount) || (Number(p.amount) || 0) / state.tasa,
        montoBS: Number(p.amount) || 0,
        tasaAplicada: state.tasa,
        terminalId: terminal?.id,
      }));
      const result = await Store.applyGlobalCustomerPaymentTransaction({
        operationId,
        customerName: globalCreditCustomer.name,
        customerCedula: globalCreditCustomer.cedula,
        amountUSD: totalUSD,
        amountBS: totalBS,
        payment: { ...payment, paymentParts },
        paymentParts,
        journal: {
          id: 'JD-' + Store.uid(), fecha: Utils.ahora(), tipo: 'ingreso',
          categoria: 'COBRO_DEUDA', montoUSD: totalUSD, montoBS: totalBS,
          metodo: payments.length > 1 ? 'mixto' : payments[0].method,
          paymentParts,
          descripcion: 'PAGO GLOBAL CxC', terminalId: terminal?.id
        },
        terminalId: terminal?.id
      });
      if (!result) throw new Error('No se pudo registrar el Pago Global.');

      // PAGO GLOBAL CxC también debe emitir comprobante. Esta ruta es la que
      // utiliza el módulo Ventas activo; anteriormente solo mostraba el toast
      // y cerraba el formulario, dejando el cobro sin ticket.
      const aplicadoUSD = Number(result.appliedUSD) || 0;
      const aplicadoBS = Number(result.appliedBS) || 0;
      const cajeroNombre = String(
        (state as any).user?.nombre ||
        (state as any).user?.name ||
        (state as any).user?.displayName ||
        (state as any).user?.email ||
        ''
      ).trim() || 'Cajero';
      const ticketPagoGlobal: any = {
        id: result.receiptId || receiptId,
        fecha: payment.fecha,
        cliente: globalCreditCustomer.name,
        items: [{
          productoId: 'COBRO_CXC_GLOBAL',
          nombre: `PAGO GLOBAL DE CxC - ${Array.isArray(result.debts) ? result.debts.length : 0} FACTURA(S)`,
          cantidad: 1,
          precioUnitUSD: aplicadoUSD,
          subtotalUSD: aplicadoUSD
        }],
        subtotalUSD: aplicadoUSD,
        descuentoUSD: 0,
        totalUSD: aplicadoUSD,
        totalBS: aplicadoBS,
        metodoPago: payment.metodo,
        estado: 'completada',
        type: 'COBRO DEUDA',
        payments: payments.map((p:any) => ({
          metodo: p.method,
          montoUSD: Number(p.usdAmount) || 0,
          montoBS: Number(p.amount) || 0
        })),
        terminalId: terminal?.id,
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        cajeroNombre,
        cajeroId: (state as any).user?.id || (state as any).user?.uid,
        tasa: state.tasa,
        reciboId: result.receiptId || receiptId
      };
      setLastProcessedSale(ticketPagoGlobal);
      setShowReceiptModal(true);

      toast({ title: 'Pago Global registrado', description: `Aplicado: ${Utils.fmtUSD(aplicadoUSD)} · ${Utils.fmtBS(aplicadoBS)}` });
      setGlobalCreditCustomer(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Pago Global no registrado', description: err?.message || 'No se pudo registrar el cobro.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenCreditDetails = async (debt: Debt) => {
    setShowDetails(debt);
    try {
      const response = await fetch(
        '/api/turso/store?table=cxc&id=' + encodeURIComponent(String(debt.id)),
        { credentials: 'include', cache: 'no-store' }
      );
      const body: any = await response.json();
      if (!response.ok || body?.ok === false) throw new Error(String(body?.error || 'Turso rechazó la lectura de la deuda.'));
      const sourceDebt: any = body?.record || debt;
      const saleId = String(sourceDebt?.ventaId || sourceDebt?.facturaId || '').trim();
      let sale: any = null;
      if (saleId) sale = await Store.getSaleById(saleId);
      if (!sale) sale = await Store.getSaleById(String(sourceDebt?.id || debt.id));
      if (sale) setShowDetails({ ...sourceDebt, __originalSale: sale });
      else setShowDetails(sourceDebt);
    } catch (e) {
      console.error('[POS Ventas] No se pudo resolver el detalle histórico de CxC:', e);
    }
  };

  const groupedCredits = useMemo(() => {
    const groups: Record<string, { totalUSD: number; debts: Debt[] }> = {};
    // La consulta de créditos es histórica: aquí NO filtramos por estado ni por
    // fecha. El Pago Global filtra sus deudas activas por separado.
    (creditDebts || []).forEach(debt => {
      const name = debt.cliente || 'DESCONOCIDO';
      if (!groups[name]) groups[name] = { totalUSD: 0, debts: [] };
      groups[name].totalUSD += Number(debt.saldoUSD) || 0;
      groups[name].debts.push(debt);
    });
    return groups;
  }, [creditDebts]);

  const normalizeCreditSearch = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const filteredGroupedCredits = useMemo(() => {
    const term = normalizeCreditSearch(creditSearch);
    if (!term) return groupedCredits;
    const result: Record<string, { totalUSD: number; debts: Debt[] }> = {};
    Object.entries(groupedCredits).forEach(([clientName, group]) => {
      const customer = (state.clientes || []).find((c: any) =>
        normalizeCreditSearch(c?.name) === normalizeCreditSearch(clientName) ||
        normalizeCreditSearch(c?.cedula) === normalizeCreditSearch(clientName)
      );
      const haystack = [
        clientName,
        customer?.name,
        customer?.cedula,
        customer?.phone,
        customer?.address,
        ...group.debts.flatMap((d: any) => [
          d?.cliente,
          d?.id,
          d?.motivo,
          d?.facturaId,
          d?.ventaId
        ])
      ].map(normalizeCreditSearch).join(' ');
      if (haystack.includes(term)) result[clientName] = group;
    });
    return result;
  }, [groupedCredits, state.clientes, creditSearch]);

  const getStockDisponible = (p: Product) => {
    let avail = p.stock || 0;
    if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
      let compPossible = Infinity;
      p.kitItems.forEach(ki => {
        const cp = state.productos.find(c => c.id === ki.productoId);
        if (cp) compPossible = Math.min(compPossible, Math.floor((cp.stock || 0) / ki.cantidad));
        else compPossible = 0;
      });
      if (compPossible !== Infinity) avail = compPossible;
    }
    return avail;
  };

  const agregar = (pid: string) => {
    const p = state.productos.find(x => x.id === pid);
    if (!p) return;
    const stockAvail = getStockDisponible(p);
    if (stockAvail <= 0) {
      toast({ variant: "destructive", title: "Sin Stock" });
      return;
    }
    setSelectedProductDisplay(p);
    const nuevoCarrito = [...state.carrito];
    const idx = nuevoCarrito.findIndex(i => i.productoId === pid);
    if (idx >= 0) {
      if (nuevoCarrito[idx].cantidad >= stockAvail) return;
      nuevoCarrito[idx].cantidad++;
      nuevoCarrito[idx].subtotalUSD = nuevoCarrito[idx].cantidad * nuevoCarrito[idx].precioUnitUSD;
    } else {
      nuevoCarrito.push({ productoId: pid, nombre: p.nombre, precioUnitUSD: p.precioUSD, cantidad: 1, subtotalUSD: p.precioUSD });
    }
    updateState({ carrito: nuevoCarrito });
    setSearch('');
    setPagos([]);
    searchInputRef.current?.focus();
  };

  const updateQty = (idx: number, delta: number) => {
    const nuevo = [...state.carrito];
    const item = nuevo[idx];
    const p = state.productos.find(x => x.id === item.productoId);
    if (!p) return;
    setSelectedProductDisplay(p);
    const stockAvail = getStockDisponible(p);
    const n = item.cantidad + delta;
    if (n <= 0) nuevo.splice(idx, 1);
    else if (n <= stockAvail) {
      item.cantidad = n;
      item.subtotalUSD = n * item.precioUnitUSD;
    }
    updateState({ carrito: nuevo });
    setPagos([]);
  };

  const handlePriceChange = (index: number, newPrice: number) => {
    const nuevo = [...state.carrito];
    nuevo[index].precioUnitUSD = newPrice;
    nuevo[index].subtotalUSD = nuevo[index].cantidad * newPrice;
    updateState({ carrito: nuevo });
    setPriceSelectorItem(null);
    toast({ title: "Precio Actualizado", description: `Nuevo precio: ${Utils.fmtUSD(newPrice)}` });
  };

  // Ajuste manual de stock desde el POS (respaldado en la colección de productos)
  const guardarStockManual = async () => {
    if (!stockEdit) return;
    const nuevoStock = Math.max(0, parseFloat(stockEditValue) || 0);
    const delta = Utils.round(nuevoStock - (stockEdit.stock || 0));
    if (Math.abs(delta) < 0.000001) {
      setStockEdit(null);
      return;
    }

    const operationId = 'AJUSTE-MANUAL-POS-' + Store.uid();
    const mov: Movimiento = {
      id: Store.uid(),
      productoId: stockEdit.id,
      tipo: delta >= 0 ? 'ajuste_entrada' : 'ajuste_salida',
      cantidad: delta,
      stockAntes: stockEdit.stock || 0,
      stockDespues: nuevoStock,
      fecha: Utils.ahora(),
      referencia: 'AJUSTE MANUAL POS',
      terminalId: getCurrentTerminal()?.id || 'GLOBAL'
    };

    try {
      await Store.applyInventoryMovementsTransaction({
        operationId,
        operationType: 'AJUSTE-INVENTARIO-POS',
        movements: [mov]
      });
      // No actualizamos productos/movimientos desde el estado local:
      // Firestore/RTDB emite el estado autoritativo a todas las cajas.
      setStockEdit(null);
      toast({ title: "Stock Actualizado", description: stockEdit.nombre + ": ajuste de " + (delta > 0 ? "+" : "") + delta + " Und." });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "No se pudo actualizar el stock",
        description: e?.message || "Otro terminal modificó el producto. Actualice e intente nuevamente."
      });
    }
  };
  const subtotalUSD = state.carrito.reduce((s, i) => s + i.subtotalUSD, 0);
  const totalBS = subtotalUSD * state.tasa;
  const totalPagadoUSD = pagos.reduce((s, p) => s + p.montoUSD, 0);
  const saldoRestanteUSD = Math.max(0, subtotalUSD - totalPagadoUSD);

  const matches = search.trim().length > 0 
    ? state.productos.filter(p => p.activo && ((p.nombre || '').toLowerCase().includes(search.toLowerCase()) || (p.codigo || '').toLowerCase().includes(search.toLowerCase()))).slice(0, 8)
    : [];

  const filteredClients = useMemo(() => {
    if (clientSearch.trim().length === 0) return [];
    const searchLower = clientSearch.toLowerCase();
    const searchNumeric = clientSearch.replace(/\D/g, '');

    return (state.clientes || []).filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(searchLower);
      const cedulaExactMatch = (c.cedula || '').toLowerCase().includes(searchLower);
      const cedulaNumericMatch = searchNumeric.length > 0 && (c.cedula || '').replace(/\D/g, '').includes(searchNumeric);

      return nameMatch || cedulaExactMatch || cedulaNumericMatch;
    });
  }, [clientSearch, state.clientes]);

  const getCurrentTerminal = () => currentTerminal;

  const guardarNuevaTasa = () => {
    const n = parseFloat(nuevaTasa);
    if (isNaN(n) || n <= 0) return alert('Tasa inválida');
    updateState({ tasa: n });
    setEditandoTasa(false);
  };

  const ejecutarVenta = async (pagosFinales?: PagoRealizado[]) => {
    if (state.carrito.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      const listadoPagos = pagosFinales || pagos;
      const terminal = getCurrentTerminal();
      const operationId = 'VENTA-POS-' + Store.uid();

      // La venta NO se confirma con un simple Store.set() local.
      // Debe pasar por la transacción atómica de Turso para que
      // venta + stock + kardex + asiento + correlativo queden persistidos
      // antes de mostrarla como completada.
      const result = await Store.createSaleTransaction({
        operationId,
        cart: state.carrito.map(x => ({ ...x })),
        payments: listadoPagos.map(x => ({ ...x })),
        clientName: cliente,
        terminalId: terminal?.id,
        fallbackReceiptNumber: terminal?.proximoRecibo || state.proximoRecibo,
        now: Utils.ahora(),
        tasa: state.tasa,
        saleType: 'VENTA',
        cajeroId: (state as any).user?.id || (state as any).user?.uid
      });

      if (!result?.sale) throw new Error('La venta no pudo confirmarse en la base de datos.');

      if (typeof window !== 'undefined') sessionStorage.removeItem('posven_current_cart');

      setLastProcessedSale(result.sale);
      setShowReceiptModal(true);
      setPagos([]);
      setCliente('Consumidor final');
      setSelectedProductDisplay(null);
      updateState({ carrito: [] });
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Venta no registrada',
        description: e?.message || 'No se pudo completar la venta. No se modificó el stock.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const ejecutarAbono = async (pagosAbono: PagoRealizado[]) => {
    if (!showAbonoModal || isProcessing) return;
    setIsProcessing(true);
    try {
      const totalAbonado = pagosAbono.reduce((s, p) => s + p.montoUSD, 0);
      if (totalAbonado <= 0) return;

      // La deuda histórica puede conservar un nombre antiguo. La identidad
      // operativa se resuelve por la cédula embebida en "cliente" y se contrasta
      // con el catálogo actual de clientes antes de generar el cobro.
      const clienteRaw = showAbonoModal.cliente || '';
      const cedulaMatch = clienteRaw.match(/\[([^\]]+)\]\s*$/);
      const cedulaDeuda = cedulaMatch?.[1]?.trim();
      const clienteActual = cedulaDeuda
        ? (state.clientes || []).find(c => c.cedula === cedulaDeuda || c.cedula.replace(/[^0-9A-Za-z]/g, '') === cedulaDeuda.replace(/[^0-9A-Za-z]/g, ''))
        : undefined;
      const nombreClienteCanonico = clienteActual?.name || (cedulaMatch ? clienteRaw.replace(/\s*\[[^\]]+\]\s*$/, '').trim() : clienteRaw) || 'CLIENTE';
      const ahoraStr = Utils.ahora(), terminal = getCurrentTerminal();
      const reciboProvisional = 'PEND-CXC-' + Store.uid().toUpperCase().slice(0, 8);
      const pagoAtomic = {
        fecha: ahoraStr,
        montoUSD: totalAbonado,
        montoBS: totalAbonado * state.tasa,
        metodo: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo,
        reciboId: reciboProvisional
      };

      const nuevasEntradasDiario: LibroDiarioEntry[] = pagosAbono.map(p => ({ id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5), fecha: ahoraStr, tipo: 'ingreso', categoria: 'COBRO_DEUDA', concepto: `ABONO DEUDA #${showAbonoModal.id} - CLIENTE: ${nombreClienteCanonico.toUpperCase()}`, montoUSD: p.montoUSD, montoBS: p.montoBS, metodo: p.metodo, referencia: reciboProvisional, terminalId: terminal?.id, terminalName: terminal?.nombre }));

      const saleAbono: Sale = {
        id: reciboProvisional, fecha: ahoraStr, cliente: nombreClienteCanonico,
        items: [{ productoId: 'ABONO', nombre: `ABONO A FACTURA #${showAbonoModal.id}`, cantidad: 1, precioUnitUSD: totalAbonado, subtotalUSD: totalAbonado }],
        subtotalUSD: totalAbonado, descuentoUSD: 0, totalUSD: totalAbonado, totalBS: totalAbonado * state.tasa,
        metodoPago: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo,
        estado: 'completada', type: 'COBRO DEUDA', payments: [...pagosAbono],
        terminalId: terminal?.id, terminalName: terminal?.nombre || 'SISTEMA GLOBAL', tasa: state.tasa
      };

      const clienteCedula = cedulaDeuda;
      const resultadoPago = await Store.applyDebtPaymentTransaction({
        collection: 'cxc',
        debtId: showAbonoModal.id,
        amountUSD: totalAbonado,
        payment: pagoAtomic,
        journal: nuevasEntradasDiario,
        sale: saleAbono,
        customerCedula: clienteCedula,
        terminalId: terminal?.id
      });
      if (!resultadoPago) throw new Error('No se pudo registrar el abono.');
      const appliedUSD = Number(resultadoPago.appliedUSD) || totalAbonado;
      if (Math.abs(appliedUSD - totalAbonado) > 0.001) throw new Error('El saldo cambió mientras se registraba el abono. La operación fue limitada al saldo real.');

      const saleFinal = resultadoPago.sale || { ...saleAbono, id: resultadoPago.receiptId || saleAbono.id };
      if (resultadoPago.sale?.payments?.length) {
        saleFinal.payments = resultadoPago.sale.payments.map((p: any) => ({ ...p }));
      }
      setLastProcessedSale(saleFinal); 
      setShowReceiptModal(true); 
      setShowAbonoModal(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const registrarMovimientoCaja = () => {
    const terminal = getCurrentTerminal();
    if (!terminal?.id) {
      toast({ variant: 'destructive', title: 'Caja no identificada', description: 'No se puede registrar un movimiento sin una caja/terminal activa.' });
      return;
    }

    const monto = Number(String(cashMovement.monto).replace(',', '.')) || 0;
    if (monto <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Indique un monto mayor que cero.' });
      return;
    }
    if (!cashMovement.concepto.trim()) {
      toast({ variant: 'destructive', title: 'Concepto requerido', description: 'Indique el motivo del movimiento de caja.' });
      return;
    }

    const tasa = Number(state.tasa) || 1;
    const montoBS = cashMovement.metodo === 'efectivo_bs' ? monto : monto * tasa;
    const montoUSD = cashMovement.metodo === 'efectivo_bs' ? monto / tasa : monto;
    const ahora = Utils.ahora();

    const entry: LibroDiarioEntry = {
      id: 'MOV-CAJA-' + Store.uid().toUpperCase().slice(0, 8),
      fecha: ahora,
      tipo: cashMovement.tipo,
      categoria: 'MOVIMIENTO_CAJA',
      concepto: cashMovement.concepto.trim().toUpperCase(),
      montoUSD: Utils.round(montoUSD),
      montoBS: Utils.round(montoBS),
      metodo: cashMovement.metodo,
      referencia: 'POS-' + String(terminal.id),
      terminalId: terminal.id,
      terminalName: terminal.nombre,
      ...(cashMovement.observacion.trim() ? { observacion: cashMovement.observacion.trim() } : {})
    } as LibroDiarioEntry;

    void (async () => {
      try {
        const result = await Store.createCashMovementTransaction({
          operationId: 'MOVIMIENTO-CAJA-' + Store.uid(),
          movement: entry,
          terminalId: terminal.id,
        });
        updateState({ libroDiario: [...(state.libroDiario || []), result.movement] });
        toast({
          title: cashMovement.tipo === 'egreso' ? 'Egreso registrado' : 'Ingreso registrado',
          description: `${cashMovement.tipo === 'egreso' ? 'Salida' : 'Entrada'} de ${cashMovement.metodo === 'efectivo_bs' ? Utils.fmtBS(monto) : Utils.fmtUSD(monto)} registrada en ${terminal.nombre}.`
        });
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Movimiento no registrado', description: e?.message || 'No se pudo persistir el movimiento en Turso.' });
      }
    })();

    setCashMovement({
      tipo: 'egreso',
      metodo: 'efectivo_usd',
      monto: '',
      concepto: '',
      observacion: ''
    });
    setShowCashMovementModal(false);
  };

  // ===== VENTA A CRÉDITO: MISMA TRANSACCIÓN TURSO QUE UNA VENTA NORMAL =====
  const ejecutarVentaACredito = async (customer: Customer) => {
    if (state.carrito.length === 0 || isProcessing) return;
    if (!customer) return alert("Seleccione un cliente.");
    
    setIsProcessing(true);
    try {
      const terminal = getCurrentTerminal();
      const cedulaNormalizada = normalizeCedula(customer.cedula, extractDocType(customer.cedula));
      const result = await Store.createSaleTransaction({
        operationId: 'VENTA-CREDITO-POS-' + Store.uid(),
        cart: state.carrito.map(x => ({ ...x })),
        payments: [],
        clientName: customer.name,
        terminalId: terminal?.id,
        fallbackReceiptNumber: terminal?.proximoRecibo || state.proximoRecibo,
        now: Utils.ahora(),
        tasa: state.tasa,
        saleType: 'VENTA CRÉDITO',
        cajeroId: (state as any).user?.id || (state as any).user?.uid,
        credit: {
          customer: { ...customer, cedula: cedulaNormalizada },
          debtId: 'CRD-PENDIENTE'
        }
      });

      if (!result?.sale || !result?.debt) throw new Error('La venta a crédito no pudo confirmarse en Turso.');
      if (typeof window !== 'undefined') sessionStorage.removeItem('posven_current_cart');

      setLastProcessedSale(result.sale);
      setShowReceiptModal(true);
      setIsCreditModalOpen(false);
      setSelectedClient(null);
      updateState({ carrito: [] });
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Venta a crédito no registrada',
        description: e?.message || 'No se pudo confirmar la venta en Turso.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ===== HANDLER PARA EL CREDIT MODAL =====
  const handleCreditModalConfirm = (customer: Customer, amount: number) => {
    if (!customer) return;
    const rawCed = getRawCedula(customer.cedula || '');
    if (rawCed.length > 0) {
      const customers = state.clientes || [];
      const exists = findCustomerByCedula(customers, customer.cedula);
      if (exists) {
        setSelectedClient(exists);
        setIsCreditModalOpen(false);
        setTimeout(() => ejecutarVentaACredito(exists), 100);
        return;
      }
      customer.cedula = normalizeCedula(customer.cedula, extractDocType(customer.cedula));
    }
    setSelectedClient(customer);
    setIsCreditModalOpen(false);
    setTimeout(() => ejecutarVentaACredito(customer), 100);
  };

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-100px)] max-w-7xl mx-auto w-full overflow-hidden">
      <div className="flex gap-2 no-print shrink-0 overflow-x-auto pb-1 items-center">
        <button onClick={() => setView('pos')} className={`btn btn-sm ${view === 'pos' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ShoppingCart className="w-3.5 h-3.5"/> Punto de Venta</button>
        <button onClick={() => setView('history')} className={`btn btn-sm ${view === 'history' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><History className="w-3.5 h-3.5"/> Historial</button>
        <button onClick={() => setView('credits')} className={`btn btn-sm ${view === 'credits' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ClipboardList className="w-3.5 h-3.5"/> Consultar Créditos</button>
        <button onClick={() => handleOpenReport('REPORT_X')} disabled={!!reportLoadingType} className={`btn btn-sm font-bold border-line border disabled:opacity-50 ${showReportType === 'REPORT_X' ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-ink'}`}><FileText className="w-3.5 h-3.5"/> {reportLoadingType === 'REPORT_X' ? 'Cargando…' : 'Reporte X'}</button>
        <button onClick={() => handleOpenReport('REPORT_Z')} disabled={!!reportLoadingType} className={`btn btn-sm font-bold border-line border disabled:opacity-50 ${showReportType === 'REPORT_Z' ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-ink'}`}><Receipt className="w-3.5 h-3.5"/> {reportLoadingType === 'REPORT_Z' ? 'Cargando…' : 'Reporte Z'}</button>
        <button onClick={() => setView('returns')} className={`btn btn-sm ${view === 'returns' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><RotateCcw className="w-3.5 h-3.5"/> Devoluciones y Anulaciones</button>
        
        {view === 'pos' && (
          <button 
            onClick={() => setIsFullScreen(!isFullScreen)} 
            className="btn btn-sm bg-white text-ink font-bold border-line border ml-auto hover:bg-brand-gold-soft transition-colors"
            title={isFullScreen ? "Minimizar" : "Expandir Pantalla Completa"}
          >
            {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {view === 'pos' ? (
        <div className={cn(
          "flex flex-col gap-2 flex-1 overflow-hidden animate-in fade-in duration-300",
          isFullScreen && "fixed inset-0 z-[100] bg-surface-warm p-6 overflow-hidden flex flex-col"
        )}>
          <div className="flex items-center gap-3 shrink-0 mb-1">
            <div className="relative group flex-1">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#c8952e] z-10"><Barcode className="w-5 h-5" /></div>
              <input ref={searchInputRef} className="form-input pl-14 py-2 text-base bg-white border-brand-gold/30 text-ink font-black placeholder-ink/40" placeholder="Escanee o busque producto..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches.length >= 1) agregar(matches[0].id); else if (e.key === 'Escape') setSearch(''); }} autoFocus />
              {matches.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-line rounded-b-lg shadow-2xl z-[100] mt-1 overflow-hidden">
                  {matches.map(p => (
                    <div key={p.id} onClick={() => agregar(p.id)} className="flex items-center justify-between p-3 hover:bg-brand-gold/10 cursor-pointer border-b border-line group">
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-ink text-sm font-black uppercase truncate group-hover:text-brand-gold-deep transition-colors">{p.nombre}</span>
                        <span className="text-ink/60 text-[10px] mono font-bold">{p.codigo}</span>
                      </div>
                      <div className="flex items-center gap-10 shrink-0 ml-4">
                         <div className="flex flex-col items-end min-w-[70px]"><span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Stock</span><span className={`text-lg font-black leading-none ${p.stock <= (p.stockMinimo || 3) ? 'text-red-600' : p.stock <= (p.stockMinimo || 3) * 2 ? 'text-amber-500' : 'text-green-600'}`}>{p.stock} <span className="text-[10px] opacity-60">Und.</span></span></div>
                         <div className="flex items-center gap-2"><div className="flex flex-col items-end min-w-[90px]"><span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Precio USD</span><span className="text-lg font-black leading-none text-ink">{Utils.fmtUSD(p.precioUSD)}</span></div><div className="flex flex-col items-end min-w-[110px]"><span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Equiv. BS</span><span className="text-lg font-black leading-none text-brand-gold-deep">{Utils.fmtBS(p.precioUSD * state.tasa)}</span></div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 bg-white px-4 py-1.5 rounded-full border border-brand-gold/30 shadow-sm shrink-0">
              <div className="w-8 h-8 rounded-full overflow-hidden border border-line shrink-0"><img src="/bcv-logo.png" alt="BCV" className="w-full h-full object-cover" /></div>
              <div className="flex items-center gap-1.5">{!editandoTasa ? (<><span className="text-ink font-black text-sm tabular-nums">{state.tasa.toFixed(2)}</span><button onClick={() => { setEditandoTasa(true); setNuevaTasa(state.tasa.toString()); }} className="text-brand-gold hover:text-brand-gold-deep p-0.5 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button></>) : (<><input type="text" value={nuevaTasa} onChange={e => setNuevaTasa(e.target.value.replace(/[^0-9.]/g, ''))} className="w-16 bg-surface-soft border border-brand-gold rounded px-1.5 py-0.5 text-ink font-black text-sm text-right outline-none" autoFocus /><button onClick={guardarNuevaTasa} className="text-status-success p-0.5"><Check className="w-4 h-4" /></button><button onClick={() => setEditandoTasa(false)} className="text-status-danger p-0.5"><X className="w-4 h-4" /></button></>)}</div>
            </div>
          </div>

          <div className="flex flex-1 gap-3 overflow-hidden">
            <div className="w-1/4 flex flex-col gap-2">
              <div className="card p-3 space-y-3 bg-white border-line h-full flex flex-col">
                <div className="form-group mb-0">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">IDENTIFICACIÓN CLIENTE</label>
                  <input className="form-input h-8 text-xs bg-surface-soft text-ink border-line font-black uppercase" value={cliente} onChange={e => setCliente(e.target.value)} />
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pt-2 border-t border-line/10">
                  {selectedProductDisplay && (
                    <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center relative"><span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">STOCK DISPONIBLE</span><span className={`text-2xl font-black ${selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) ? 'text-status-danger' : selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) * 2 ? 'text-status-warn' : 'text-status-success'}`}>{selectedProductDisplay.stock} <span className="text-xs">UND</span></span><button onClick={() => { setStockEdit(selectedProductDisplay); setStockEditValue(String(selectedProductDisplay.stock || 0)); }} title="Ajustar stock manualmente" className="absolute top-1 right-1 p-1 text-ink/30 hover:text-brand-gold-deep transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button></div>
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center"><span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">PRECIO UNITARIO USD</span><span className="text-2xl font-black text-ink">{Utils.fmtUSD(selectedProductDisplay.precioUSD)}</span></div>
                       <div className="p-3 bg-brand-gold-soft/30 border border-brand-gold-soft/30 rounded-xl text-center"><span className="text-[9px] font-black uppercase text-brand-gold-deep block mb-1">EQUIVALENTE EN BOLÍVARES</span><span className="text-2xl font-black text-brand-gold-deep">{Utils.fmtBS(selectedProductDisplay.precioUSD * state.tasa)}</span></div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {state.carrito.length > 0 && (
                      <button onClick={() => setIsCreditModalOpen(true)} className="w-full h-10 border-2 border-status-info text-status-info hover:bg-status-info-soft font-black uppercase text-[10px] rounded-xl transition-all">Cargar a Crédito</button>
                    )}
                    <button onClick={() => setShowCashMovementModal(true)} className={`w-full h-10 border-2 border-status-success text-status-success hover:bg-status-success/10 font-black uppercase text-[10px] rounded-xl transition-all ${state.carrito.length === 0 ? 'col-span-2' : ''}`}>
                      Movimiento de Caja
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-3/4 flex flex-col gap-2 overflow-hidden">
              <div className="card flex-1 flex flex-col overflow-hidden bg-white border-none shadow-xl">
                <div className="grid grid-cols-[1fr_80px_70px_35px_80px_80px_80px_35px] gap-1 px-3 py-3 bg-ink text-white text-[10px] font-black uppercase tracking-[0.12em] rounded-t-lg">
                  <div>Descripción</div><div className="text-center">Cant</div><div className="text-center">U.M.</div><div /> <div className="text-right">Precio ($)</div><div className="text-right">Precio (Bs)</div><div className="text-right">Total</div><div className="text-center"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-1 space-y-1">
                  {state.carrito.map((item, i) => {
                    const prod = state.productos.find(p => p.id === item.productoId);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_80px_70px_35px_80px_80px_80px_35px] gap-1 items-center px-3 py-3 bg-white border-b border-black/5 text-ink">
                        <div className="truncate font-black text-xs uppercase leading-tight">{item.nombre}</div>
                        <div className="flex items-center justify-center gap-1 bg-surface-soft rounded p-0.5 border border-line/30"><button onClick={() => updateQty(i, -1)} className="text-ink font-black text-sm px-1.5">-</button><span className="w-5 text-center text-xs font-black">{item.cantidad}</span><button onClick={() => updateQty(i, 1)} className="text-ink font-black text-sm px-1.5">+</button></div>
                        <div className="text-center text-[10px] font-black uppercase">{prod?.cantidad || '-'}</div>
                        <div className="flex justify-center">
                          <button 
                            onClick={() => prod && setPriceSelectorItem({ index: i, product: prod })}
                            className="text-brand-gold hover:text-brand-gold-deep transition-colors p-1 bg-brand-gold-soft/20 rounded-md"
                            title="Cambiar Precio (Alternativos)"
                          >
                            <Tag className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-right text-xs font-black">{Utils.fmtUSD(item.precioUnitUSD)}</div>
                        <div className="text-right text-xs font-black">{Utils.fmtBS(item.precioUnitUSD * state.tasa)}</div>
                        <div className="text-right text-sm font-black">{Utils.fmtUSD(item.subtotalUSD)}</div>
                        <div className="flex justify-center"><button onClick={() => updateQty(i, -item.cantidad)} className="text-ink/20 hover:text-red-600"><Trash2 className="w-4 h-4"/></button></div>
                      </div>
                    );
                  })}
                </div>
                <div className="p-4 bg-ink border-t border-line/10 flex items-center justify-between rounded-b-lg gap-6">
                  <div className="space-y-0 shrink-0"><label className="text-white/60 text-[8px] font-black uppercase block tracking-widest mb-1">TOTAL FACTURA</label><div className="text-4xl font-black text-brand-gold leading-none">{Utils.fmtUSD(subtotalUSD)}</div></div>
                  <div className="flex-1 flex justify-end items-center pr-4"><div className="text-4xl font-black text-white">{Utils.fmtBS(totalBS)}</div></div>
                  
                  <div className="flex items-center gap-3">
                    {isFullScreen && (
                      <button 
                        onClick={() => setIsFullScreen(false)} 
                        className="w-14 h-14 bg-white/10 border-2 border-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-all transform hover:scale-105"
                        title="Minimizar (ESC)"
                      >
                        <Minimize2 className="w-6 h-6" />
                      </button>
                    )}
                    <button onClick={() => saldoRestanteUSD <= 0.01 && state.carrito.length > 0 ? ejecutarVenta() : setShowMultiModal(true)} disabled={state.carrito.length === 0 || isProcessing} className="w-14 h-14 bg-[#c8952e] text-black rounded-full shadow-lg flex items-center justify-center hover:bg-[#d9a540] transition-all transform hover:scale-105 active:scale-95 disabled:opacity-20 shrink-0">
                      {isProcessing ? <Loader2 className="w-8 h-8 animate-spin" /> : (saldoRestanteUSD <= 0.01 && state.carrito.length > 0 ? <Check className="w-8 h-8" /> : <Wallet className="w-8 h-8" />)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : view === 'history' ? (
        <div className="card flex-1 bg-white flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-300 rounded-xl">
          <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center"><h3 className="text-white font-black uppercase italic tracking-tighter flex items-center gap-2 text-xs"><History className="w-5 h-5 text-brand-gold" /> HISTORIAL TERMINAL: {currentTerminal?.nombre || 'S/T'}</h3><button onClick={() => setView('pos')} className="btn btn-sm bg-white text-ink hover:bg-surface-soft flex items-center gap-2 font-black uppercase text-[10px] rounded-lg border-none px-4"><ArrowLeft className="w-3.5 h-3.5"/> Volver al POS</button></div>
          <div className="table-wrap flex-1 overflow-y-auto">
            <table>
              <thead><tr><th>Recibo</th><th>Hora</th><th>Terminal</th><th>Cliente</th><th>Tipo</th><th className="text-right">Monto USD</th><th className="text-right">Equiv. BS</th><th>Método</th><th className="text-center">Estado</th><th className="text-center">Acciones</th></tr></thead>
              <tbody>
                {histPageVentas.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-20 text-ink/20 font-black italic uppercase">Sin ventas registradas en esta terminal</td></tr>
                ) : histPageVentas.map(v => (
                  <tr key={v.id} className="border-b border-line/40 hover:bg-surface-warm/20"><td className="text-ink font-black text-xs mono">{v.id}</td><td className="text-ink font-bold text-xs">{v.fecha.split('T')[1]?.slice(0, 5)}</td><td className="text-ink font-black text-[10px] uppercase">{v.terminalName || state.terminales.find(t => t.id === v.terminalId)?.nombre || '-'}</td><td className="text-ink font-black text-xs uppercase truncate max-w-[150px]">{v.cliente}</td><td className="text-ink font-black text-[9px] uppercase"><span className={`badge ${v.esMovimientoCaja ? 'badge-warn' : (v.type === 'COBRO DEUDA' ? 'badge-info' : 'badge-neutral')}`}>{v.type || 'VENTA'}</span></td><td className="text-brand-gold-deep font-black text-xs text-right">{Utils.fmtUSD(getSaleCurrencyTotals(v).usd)}</td><td className="text-ink font-black text-xs text-right">{Utils.fmtBS(getSaleCurrencyTotals(v).bs)}</td><td className="text-ink font-bold text-[10px] uppercase">{Utils.metodoLabel(v.metodoPago)}</td><td className="text-center"><span className={`badge ${v.esMovimientoCaja ? (v.estado === 'egreso' ? 'badge-err' : 'badge-ok') : (v.estado === 'pendiente' ? 'badge-warn' : (v.estado === 'anulada' ? 'badge-err' : 'badge-ok'))} font-black text-[9px] uppercase`}>{v.esMovimientoCaja ? (v.estado === 'egreso' ? 'EGRESO' : 'INGRESO') : v.estado}</span></td><td className="text-center">{v.esMovimientoCaja ? <button onClick={() => alert(`Concepto del movimiento:\n\n${v.concepto || v.cliente || v.descripcion || v.motivo || 'Sin concepto registrado'}${v.observacion ? `\n\nObservación:\n${v.observacion}` : ''}`)} className="w-7 h-7 rounded-full flex items-center justify-center text-status-success hover:bg-status-success/10 transition-colors" title="Ver motivo del movimiento"><Eye className="w-4 h-4" /></button> : <button onClick={() => setShowSaleDetail(v)} className="w-7 h-7 rounded-full flex items-center justify-center text-status-success hover:bg-status-success/10 transition-colors" title="Ver ítems y detalle de venta"><Eye className="w-4 h-4" /></button>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={histSafePage} totalPages={histTotalPages} total={histVentas.length} pageSize={histPageSize} onPageChange={setHistPage} />
        </div>
      ) : view === 'credits' ? (
        <div className="card flex-1 bg-white flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-300 rounded-xl">
          <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center"><h3 className="text-white font-black uppercase italic tracking-tighter flex items-center gap-2 text-xs"><ClipboardList className="w-5 h-5 text-brand-gold" /> CONSULTA CRÉDITOS Y COBRANZA (GLOBAL)</h3><button onClick={() => setView('pos')} className="btn btn-sm bg-white text-ink hover:bg-surface-soft flex items-center gap-2 font-black uppercase text-[10px] rounded-lg border-none px-4"><ArrowLeft className="w-3.5 h-3.5"/> Volver al POS</button></div>
          <div className="px-5 py-3 bg-white border-b border-line">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
              <input
                value={creditSearch}
                onChange={e => setCreditSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-10 bg-surface-soft border border-line rounded-xl text-xs font-black uppercase text-ink outline-none focus:border-brand-gold"
                placeholder="BUSCAR CLIENTE: NOMBRE, PALABRA CLAVE O CÉDULA..."
                aria-label="Buscar cliente con deuda por nombre, palabra clave o cédula"
              />
              {creditSearch && (
                <button onClick={() => setCreditSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink/40 hover:text-ink" aria-label="Limpiar búsqueda">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="table-wrap flex-1 overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="px-6 py-3"></th>
                  <th className="text-ink font-black text-[10px] uppercase">Cliente / Identificación</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Documentos</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Saldo USD</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Saldo BS</th>
                  <th className="text-ink font-black text-[10px] uppercase text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(filteredGroupedCredits).length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-20 text-ink font-black uppercase italic">No hay deudas registradas</td></tr>
                ) : (
                  Object.entries(filteredGroupedCredits).map(([clientName, group]) => (
                    <React.Fragment key={clientName}>
                      <tr className="border-b border-line hover:bg-surface-warm/20 transition-colors">
                        <td className="px-6 py-4">
                           <button onClick={() => setExpandedClient(expandedClient === clientName ? null : clientName)} className="text-brand-gold hover:scale-110 transition-transform">{expandedClient === clientName ? <ChevronUp /> : <ChevronDown />}</button>
                        </td>
                        <td className="py-4"><div className="text-ink font-black text-sm uppercase">{clientName}</div></td>
                        <td className="text-right py-4 font-black text-ink">{group.debts.length} Facturas</td>
                        <td className="text-right py-4 font-black text-status-info text-base">{Utils.fmtUSD(group.totalUSD)}</td>
                        <td className="text-right py-4 font-black text-ink">{Utils.fmtBS(group.totalUSD * state.tasa)}</td>
                        <td className="text-center py-4"><div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleOpenGlobalCreditPayment(clientName, group.debts)} className="h-10 px-3 rounded-full flex items-center justify-center gap-1.5 bg-brand-gold text-black border-2 border-brand-gold hover:bg-brand-gold-deep transition-all shadow-md font-black text-[9px] uppercase whitespace-nowrap" title="PAGO GLOBAL" aria-label="PAGO GLOBAL">
                            <HandCoins className="w-4 h-4" /><span>PAGO GLOBAL</span>
                          </button>
                          <button onClick={() => setShowClientHistory(clientName)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5" /></button>
                        </div></td>
                      </tr>
                      {expandedClient === clientName && (
                        <tr className="bg-surface-soft/40 animate-in slide-in-from-top-1 duration-200">
                           <td colSpan={6} className="px-12 py-4">
                              <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                                 <div className="overflow-x-auto">
                                   <table data-credit-history-version="sales-v1" className="w-full min-w-[780px]">
                                      <thead className="bg-ink/5">
                                        <tr>
                                          <th className="text-[9px] font-black uppercase p-2 text-left">Emisión</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left">Vencimiento</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left">ID Factura</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right">Monto</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right">Saldo USD</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center">Estado</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center">Auditoría</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.debts.map(d => (
                                          <tr key={d.id} className="border-b border-line/20">
                                            <td className="text-[10px] font-black p-2">{Utils.fmtFecha(d.fecha)}</td>
                                            <td className={`text-[10px] font-black p-2 ${Number(d.saldoUSD) > 0.001 && d.fechaVencimiento < Utils.hoy() ? 'text-status-danger' : 'text-ink'}`}>{d.fechaVencimiento === '2099-12-31' ? 'ABIERTA' : Utils.fmtFecha(d.fechaVencimiento)}</td>
                                            <td className="text-[10px] font-black p-2 mono">{d.id}</td>
                                            <td className="text-[10px] font-black p-2 text-right">{Utils.fmtUSD(d.montoUSD)}</td>
                                            <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                                            <td className="text-[10px] font-black p-2 text-center uppercase">{d.estado}</td>
                                            <td className="p-2 text-center">
                                              <button onClick={() => { void handleOpenCreditDetails(d); }} className="w-8 h-8 rounded-full flex items-center justify-center text-status-success hover:bg-status-success/10" title="Auditar factura">
                                                <Eye className="w-4 h-4"/>
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                   </table>
                                 </div>
                              </div>
                           </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ReturnsModule state={state} updateState={updateState} onBackToPOS={() => setView('pos')} terminalId={currentTerminal?.id} />
      )}

      {priceSelectorItem && (
        <div className="modal show" style={{ zIndex: 120 }}><div className="modal-bg" onClick={() => setPriceSelectorItem(null)}></div>
          <div className="modal-box max-w-sm bg-white border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-3 px-5 border-b border-line bg-ink text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                <Tag className="w-4 h-4 text-brand-gold" /> Selección de Tarifa
              </h3>
              <button onClick={() => setPriceSelectorItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="modal-body p-6 space-y-4">
               <p className="text-[10px] font-black uppercase text-ink/40 text-center tracking-tighter">{priceSelectorItem.product.nombre}</p>
               
               <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioUSD)} className="flex justify-between items-center p-4 bg-surface-soft border border-line rounded-xl hover:border-brand-gold transition-all group">
                    <span className="text-xs font-black text-ink uppercase">Precio Estándar</span>
                    <span className="text-sm font-black text-ink group-hover:text-brand-gold-deep">{Utils.fmtUSD(priceSelectorItem.product.precioUSD)}</span>
                  </button>
                  
                  {priceSelectorItem.product.precioMayorUSD && priceSelectorItem.product.precioMayorUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioMayorUSD!)} className="flex justify-between items-center p-4 bg-brand-gold-soft/20 border border-brand-gold/20 rounded-xl hover:border-brand-gold transition-all group">
                      <span className="text-xs font-black text-brand-gold-deep uppercase">Precio al Mayor</span>
                      <span className="text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(priceSelectorItem.product.precioMayorUSD)}</span>
                    </button>
                  )}

                  {priceSelectorItem.product.precioOfertaUSD && priceSelectorItem.product.precioOfertaUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioOfertaUSD!)} className="flex justify-between items-center p-4 bg-status-success-soft/20 border border-status-success/20 rounded-xl hover:border-status-success transition-all group">
                      <span className="text-xs font-black text-status-success uppercase">Precio Oferta</span>
                      <span className="text-sm font-black text-status-success">{Utils.fmtUSD(priceSelectorItem.product.precioOfertaUSD)}</span>
                    </button>
                  )}

                  {priceSelectorItem.product.precioPromoUSD && priceSelectorItem.product.precioPromoUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioPromoUSD!)} className="flex justify-between items-center p-4 bg-status-info-soft/20 border border-status-info/20 rounded-xl hover:border-status-info transition-all group">
                      <span className="text-xs font-black text-status-info uppercase">Precio Promoción</span>
                      <span className="text-sm font-black text-status-info">{Utils.fmtUSD(priceSelectorItem.product.precioPromoUSD)}</span>
                    </button>
                  )}
               </div>
            </div>
          </div>
        </div>
      )}

      {globalCreditCustomer && (
        <FloatingPaymentModal
          total={globalCreditCustomer.totalBS}
          totalCents={Math.round(globalCreditCustomer.totalBS * 100)}
          exchangeRate={state.tasa}
          allowPartial={true}
          onClose={() => setGlobalCreditCustomer(null)}
          onConfirm={(data) => { void handleProcessGlobalCreditPayment(data.payments); }}
        />
      )}
      {showReceiptModal && (
        <ReceiptModal 
          isOpen={showReceiptModal} 
          onClose={() => { 
            setShowReceiptModal(false); 
            setLastProcessedSale(null); 
          }} 
          saleData={lastProcessedSale} 
          type="SALE" 
        />
      )}
      
      {showReportType === 'REPORT_X' && reportSnapshot && (
        <ReceiptModal
          isOpen={true}
          onClose={() => {
            setShowReportType(null);
            setReportSnapshot(null);
          }}
          reportData={reportSnapshot}
          type="REPORT_X"
        />
      )}

      {showReportType === 'REPORT_Z' && reportSnapshot && (
        <ZReportPreview80mm
          data={reportSnapshot}
          onClose={() => {
            setShowReportType(null);
            setReportSnapshot(null);
          }}
        />
      )}

      {showZArqueo && reportSnapshot && (
        <CashZArqueoModal
          open={showZArqueo}
          report={reportSnapshot}
          onCancel={() => {
            setShowZArqueo(false);
            setShowReportType(null);
            setReportSnapshot(null);
          }}
          onConfirm={(real, diff) => ejecutarCierreZ(real, diff)}
        />
      )}
      
      {showMultiModal && (
        <FloatingPaymentModal 
          total={totalBS} 
          totalCents={Math.round(totalBS * 100)} 
          exchangeRate={state.tasa} 
          onClose={() => setShowMultiModal(false)} 
          onConfirm={(data) => { 
            ejecutarVenta(data.payments.map(p => ({ 
              metodo: p.method as PaymentMethod, 
              montoUSD: p.usdAmount || (p.amount / state.tasa), 
              montoBS: p.amount 
            }))); 
            setShowMultiModal(false); 
          }} 
        />
      )}
      
      {showAbonoModal && (
        <FloatingPaymentModal 
          total={showAbonoModal.saldoUSD * state.tasa} 
          totalCents={Math.round(showAbonoModal.saldoUSD * state.tasa * 100)} 
          exchangeRate={state.tasa} 
          onClose={() => setShowAbonoModal(null)} 
          allowPartial={true} 
          onConfirm={(data) => { 
            ejecutarAbono(data.payments.map(p => ({ 
              metodo: p.method as PaymentMethod, 
              montoUSD: p.usdAmount || (p.amount / state.tasa), 
              montoBS: p.amount 
            }))); 
          }} 
        />
      )}

      {showCashMovementModal && (
        <div className="fixed inset-0 z-[160] bg-black/60 flex items-center justify-center p-4 animate-in fade-in-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border-2 border-line">
            <div className="px-5 py-4 bg-ink text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase italic tracking-tight">Movimiento de Caja</h3>
                <p className="text-[9px] text-white/50 font-bold uppercase mt-1">{currentTerminal?.nombre || 'Caja no identificada'}</p>
              </div>
              <button onClick={() => setShowCashMovementModal(false)} className="p-1 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCashMovement(v => ({ ...v, tipo: 'egreso' }))}
                  className={`h-11 rounded-xl border-2 font-black uppercase text-[10px] flex items-center justify-center gap-2 ${cashMovement.tipo === 'egreso' ? 'border-status-danger bg-status-danger/10 text-status-danger' : 'border-line text-ink/50'}`}
                >
                  <ArrowDownCircle className="w-4 h-4" /> Egreso
                </button>
                <button
                  onClick={() => setCashMovement(v => ({ ...v, tipo: 'ingreso' }))}
                  className={`h-11 rounded-xl border-2 font-black uppercase text-[10px] flex items-center justify-center gap-2 ${cashMovement.tipo === 'ingreso' ? 'border-status-success bg-status-success/10 text-status-success' : 'border-line text-ink/50'}`}
                >
                  <ArrowUpCircle className="w-4 h-4" /> Ingreso
                </button>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase text-ink/50 block mb-1">Método de pago</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCashMovement(v => ({ ...v, metodo: 'efectivo_bs' }))}
                    className={`h-12 rounded-xl border-2 font-black uppercase text-[10px] ${cashMovement.metodo === 'efectivo_bs' ? 'border-brand-gold bg-brand-gold-soft text-brand-gold-deep' : 'border-line text-ink/60'}`}
                  >Efectivo Bs.</button>
                  <button
                    onClick={() => setCashMovement(v => ({ ...v, metodo: 'efectivo_usd' }))}
                    className={`h-12 rounded-xl border-2 font-black uppercase text-[10px] ${cashMovement.metodo === 'efectivo_usd' ? 'border-brand-gold bg-brand-gold-soft text-brand-gold-deep' : 'border-line text-ink/60'}`}
                  >Efectivo USD</button>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase text-ink/50 block mb-1">Monto ({cashMovement.metodo === 'efectivo_bs' ? 'Bs.' : 'USD'})</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={cashMovement.monto}
                  onChange={e => setCashMovement(v => ({ ...v, monto: e.target.value.replace(/[^0-9.,]/g, '') }))}
                  className="w-full h-12 px-4 bg-surface-soft border border-line rounded-xl text-lg font-black text-right outline-none focus:border-brand-gold"
                  placeholder={cashMovement.metodo === 'efectivo_bs' ? '0,00' : '0.00'}
                />
                <p className="text-[9px] font-bold text-ink/50 mt-1 text-right">
                  Equiv. {cashMovement.metodo === 'efectivo_bs' ? 'USD' : 'Bs.'}: {
                    cashMovement.metodo === 'efectivo_bs'
                      ? Utils.fmtUSD((Number(String(cashMovement.monto).replace(',', '.')) || 0) / (Number(state.tasa) || 1))
                      : Utils.fmtBS((Number(String(cashMovement.monto).replace(',', '.')) || 0) * (Number(state.tasa) || 1))
                  }
                </p>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase text-ink/50 block mb-1">Concepto</label>
                <input
                  value={cashMovement.concepto}
                  onChange={e => setCashMovement(v => ({ ...v, concepto: e.target.value }))}
                  className="w-full h-11 px-4 bg-white border border-line rounded-xl text-xs font-black uppercase outline-none focus:border-brand-gold"
                  placeholder="Ej.: Entrega al administrador"
                />
              </div>

              <div>
                <label className="text-[9px] font-black uppercase text-ink/50 block mb-1">Observación (opcional)</label>
                <textarea
                  value={cashMovement.observacion}
                  onChange={e => setCashMovement(v => ({ ...v, observacion: e.target.value }))}
                  className="w-full min-h-[70px] px-4 py-3 bg-white border border-line rounded-xl text-xs font-bold outline-none focus:border-brand-gold resize-none"
                  placeholder="Detalle adicional del movimiento..."
                />
              </div>
            </div>

            <div className="p-4 bg-surface-soft border-t border-line flex justify-end gap-2">
              <button onClick={() => setShowCashMovementModal(false)} className="px-5 h-10 rounded-xl font-black uppercase text-[10px] text-ink/60 hover:bg-white">Cancelar</button>
              <button onClick={registrarMovimientoCaja} className="px-6 h-10 rounded-xl bg-brand-gold text-black font-black uppercase text-[10px] hover:bg-brand-gold-deep shadow-md">
                Registrar Movimiento
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaleDetail && (
        <div className="modal show" style={{ zIndex: 115 }}><div className="modal-bg" onClick={() => setShowSaleDetail(null)}></div>
          <div className="modal-box max-w-[620px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Receipt className="w-5 h-5 text-brand-gold" /> AUDITORÍA DE VENTA: {showSaleDetail.id}
              </h3>
              <button onClick={() => setShowSaleDetail(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-5 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink block mb-1">Fecha</label>
                  <p className="text-sm font-black text-ink">{Utils.fmtFecha(showSaleDetail.fecha)}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink block mb-1">Cliente</label>
                  <p className="text-sm font-black text-ink uppercase truncate">{showSaleDetail.cliente || 'Consumidor final'}</p>
                </div>
                <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
                  <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Total USD</label>
                  <p className="text-lg font-black text-brand-gold-deep">{Utils.fmtUSD(showSaleDetail.totalUSD)}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink block mb-1">Tipo</label>
                  <p className="text-[10px] font-black text-ink uppercase">{showSaleDetail.type || 'VENTA'}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink block mb-1">Método</label>
                  <p className="text-[10px] font-black text-ink uppercase">{Utils.metodoLabel(showSaleDetail.metodoPago)}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink block mb-1">Estado</label>
                  <p className="text-[10px] font-black uppercase"><span className={`badge ${showSaleDetail.estado === 'pendiente' ? 'badge-warn' : (showSaleDetail.estado === 'anulada' ? 'badge-err' : 'badge-ok')} font-black text-[9px] uppercase`}>{showSaleDetail.estado}</span></p>
                </div>
              </div>

              <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                <div className="flex justify-between items-center border-b border-line pb-2">
                  <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DESGLOSE DE ÍTEMS</h4>
                  <span className="text-[9px] font-black text-ink uppercase">{showSaleDetail.items?.length || 0} ítems</span>
                </div>
                <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-ink/5">
                        <th className="text-[8px] font-black uppercase p-2 text-left">Cant</th>
                        <th className="text-[8px] font-black uppercase p-2 text-left">Descripción</th>
                        <th className="text-[8px] font-black uppercase p-2 text-right">P. Unit</th>
                        <th className="text-[8px] font-black uppercase p-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!showSaleDetail.items || showSaleDetail.items.length === 0) ? (
                        <tr><td colSpan={4} className="text-center py-10 text-ink font-black uppercase italic text-[10px]">Sin desglose de ítems disponible para esta referencia</td></tr>
                      ) : showSaleDetail.items.map((it: any, idx: number) => (
                        <tr key={idx} className="border-b border-line/20">
                          <td className="text-[9px] font-black p-2">{it.cantidad}</td>
                          <td className="text-[9px] font-black uppercase p-2 truncate max-w-[220px]">{it.nombre}</td>
                          <td className="text-[9px] font-black p-2 text-right">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                          <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
              <button onClick={() => setShowSaleDetail(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showDetails && (
        <div className="modal show" style={{ zIndex: 110 }}><div className="modal-bg" onClick={() => setShowDetails(null)}></div>
          <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Receipt className="w-5 h-5 text-brand-gold" /> HISTORIAL DETALLADO: {showDetails.id}
              </h3>
              <button onClick={() => setShowDetails(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
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

              {(() => {
                const sale = showDetails.__originalSale || state.ventas.find(v => v.id === showDetails.ventaId || v.id === showDetails.id);
                if (!sale) return null;
                return (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                       <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE COMPRA ORIGINAL</h4>
                       <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(sale.fecha)}</span>
                    </div>
                    <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                       <table className="w-full">
                          <thead>
                            <tr className="bg-ink/5">
                               <th className="text-[8px] font-black uppercase p-2 text-left">Cant</th>
                               <th className="text-[8px] font-black uppercase p-2 text-left">Descripción</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right">P. Unit</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sale.items.map((it: any, idx: number) => (
                              <tr key={idx} className="border-b border-line/20">
                                 <td className="text-[9px] font-black p-2">{it.cantidad}</td>
                                 <td className="text-[9px] font-black uppercase p-2 truncate max-w-[180px]">{it.nombre}</td>
                                 <td className="text-[9px] font-black p-2 text-right">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3">
                 <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS</h4>
                 <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {(!showDetails.historialPagos || showDetails.historialPagos.length === 0) ? (
                      <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han registrado abonos aún</div>
                    ) : (
                      showDetails.historialPagos.map((p: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                           <div className="space-y-0.5">
                              <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)}</p>
                              <p className="text-[8px] font-black text-ink mono">REF: {p.reciboId}</p>
                           </div>
                           <div className="text-right">
                              <p className="text-xs font-black text-status-success">+{Utils.fmtUSD(p.montoUSD)}</p>
                              <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
                           </div>
                        </div>
                      ))
                    )}
                 </div>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowDetails(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showClientHistory && (
        <div className="modal show" style={{ zIndex: 105 }}><div className="modal-bg" onClick={() => setShowClientHistory(null)}></div>
          <div className={`modal-box max-w-4xl bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl transition-all ${showDetails ? 'blur-sm scale-95 opacity-40 pointer-events-none' : ''}`}>
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black uppercase italic tracking-tighter text-xs flex items-center gap-2">
                <Contact className="w-5 h-5 text-brand-gold" /> ESTADO DE CUENTA MAESTRO: {showClientHistory}
              </h3>
              <button onClick={() => setShowClientHistory(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-0 max-h-[70vh] overflow-y-auto bg-white">
               <div className="table-wrap">
                  <table className="w-full">
                    <thead className="bg-surface-soft sticky top-0 z-10">
                      <tr>
                        <th className="text-[9px] font-black uppercase p-4 text-left">Fecha</th>
                        <th className="text-[9px] font-black uppercase p-4 text-left">ID Documento</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Monto Total</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Abonado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Saldo Pend.</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center">Estado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center">Auditoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditDebts.filter(d => d.cliente === showClientHistory).sort((a,b) => b.fecha.localeCompare(a.fecha)).map(d => (
                        <tr key={d.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                          <td className="p-4 text-xs font-black">{Utils.fmtFecha(d.fecha)}</td>
                          <td className="p-4 text-xs font-black mono">{d.id}</td>
                          <td className="p-4 text-right text-xs font-black">{Utils.fmtUSD(d.montoUSD)}</td>
                          <td className="p-4 text-right text-xs font-black text-status-success">{Utils.fmtUSD(d.abonadoUSD)}</td>
                          <td className="p-4 text-right text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                          <td className="p-4 text-center">
                            <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                              {d.estado}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                             <button onClick={() => { void handleOpenCreditDetails(d); }} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5"/></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowClientHistory(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* AJUSTE MANUAL DE STOCK (POS) */}
      {/* ============================================================ */}
      {stockEdit && (
        <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4 animate-in fade-in-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5 space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Ajustar Stock Manual</p>
              <p className="font-black text-sm text-ink uppercase leading-tight truncate">{stockEdit.nombre}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={stockEditValue}
                onChange={e => setStockEditValue(e.target.value.replace(/[^0-9.]/g, ''))}
                onKeyDown={e => e.key === 'Enter' && guardarStockManual()}
                className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl font-black focus:ring-2 focus:ring-[#D4A017] outline-none text-center text-lg"
                autoFocus
              />
              <span className="text-[10px] font-black text-gray-400 uppercase">Und.</span>
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase leading-tight">Stock actual: <b className="text-ink">{stockEdit.stock || 0}</b> Und.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setStockEdit(null)} className="px-4 py-2 text-gray-400 font-bold hover:text-gray-600 transition-colors text-xs uppercase">Cancelar</button>
              <button onClick={guardarStockManual} className="px-5 py-2 bg-blue-600 text-white rounded-xl font-black text-xs uppercase hover:bg-blue-700 transition-all"><Check className="w-3.5 h-3.5 inline mr-1" />Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL DE CRÉDITO - AHORA RECIBE CLIENTES Y DEUDAS PARA MOSTRAR SALDO */}
      {/* ============================================================ */}
      <CreditModal
        isOpen={isCreditModalOpen}
        onClose={() => setIsCreditModalOpen(false)}
        onConfirm={handleCreditModalConfirm}
        totalAmount={subtotalUSD}
        {...({ 
          clients: state.clientes || [], 
          debts: state.cxc || [], 
          initialClientName: cliente 
        } as any)}
      />
    </div>
  );
}