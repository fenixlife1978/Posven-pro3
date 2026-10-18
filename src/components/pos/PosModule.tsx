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
import { auth } from '@/lib/firebase';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import FloatingPaymentModal from '@/components/pos/FloatingPaymentModal';
import { toast } from '@/hooks/use-toast';
import { AppState, SaleItem, Sale, PaymentMethod, ReportZ, PagoRealizado, Customer, Return, ReturnItem, Product, Debt, Movimiento, LibroDiarioEntry } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import ReturnsModule from '@/components/modules/ReturnsModule';
import { cn } from '@/lib/utils';

// ✅ ELIMINADO: El declare global ya está en ReceiptModal.tsx

export default function SalesModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pos' | 'history' | 'credits' | 'returns'>('pos');
  const [showReportType, setShowReportType] = useState<'REPORT_X' | 'REPORT_Z' | null>(null);
  const [reportSnapshot, setReportSnapshot] = useState<any>(null);
  const [cliente, setCliente] = useState('Consumidor final');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [pagos, setPagos] = useState<PagoRealizado[]>([]);
  const [showMultiModal, setShowMultiModal] = useState(false);
  
  const [showAbonoModal, setShowAbonoModal] = useState<Debt | null>(null);
  
  const [showDetails, setShowDetails] = useState<any | null>(null);
  const [lastProcessedSale, setLastProcessedSale] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedProductDisplay, setSelectedProductDisplay] = useState<Product | null>(null);
  
  const [priceSelectorItem, setPriceSelectorItem] = useState<{ index: number, product: Product } | null>(null);

  const [isCreditView, setIsCreditView] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Customer | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', tipoDoc: 'V', cedula: '', phone: '', address: '' });

  const [editandoTasa, setEditandoTasa] = useState(false);
  const [nuevaTasa, setNuevaTasa] = useState(state.tasa.toString());

  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showClientHistory, setShowClientHistory] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const formatVNCedula = (val: string) => {
    const digits = val.replace(/\D/g, '');
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const handleNewClientCedulaChange = (val: string) => {
    setNewClient({ ...newClient, cedula: formatVNCedula(val) });
  };

  const currentTerminal = useMemo(() => {
    return auth?.currentUser ? state.terminales.find(t => t.usuarioId === auth.currentUser!.uid) : null;
  }, [state.terminales]);

  const getFreshReportData = () => {
    const corteTimestamp = state.fechaUltimoZ || '';
    const termId = currentTerminal?.id || 'GLOBAL';
    
    const vActivas = (state.ventas || []).filter(v => v.fecha > corteTimestamp && v.estado !== 'anulada' && v.terminalId === termId);
    const vAnuladas = (state.ventas || []).filter(v => v.fecha > corteTimestamp && v.estado === 'anulada' && v.terminalId === termId);
    const dHoy = (state.devoluciones || []).filter(d => d.fecha > corteTimestamp && (state.ventas.find(v => v.id === d.ventaId)?.terminalId === termId));
    
    const brUSD = vActivas.reduce((s, v) => s + v.totalUSD, 0);
    const devUSD = dHoy.reduce((s, d) => s + d.totalUSD, 0);
    const descUSD = vActivas.reduce((s, v) => s + (v.descuentoUSD || 0), 0);
    const netUSD = brUSD - devUSD - descUSD;

    const baseImponibleUSD = vActivas.reduce((s, v) => s + (v.baseImponibleUSD || 0), 0);
    const ivaUSD = vActivas.reduce((s, v) => s + (v.ivaUSD || 0), 0);
    const exentoUSD = vActivas.reduce((s, v) => s + (v.exentoUSD || 0), 0);
    const igtfUSD = vActivas.reduce((s, v) => s + (v.igtfUSD || 0), 0);

    const paymentMethodsMap: Record<string, number> = {};
    vActivas.forEach(v => {
      if (v.payments && v.payments.length > 0) {
        v.payments.forEach(p => {
          paymentMethodsMap[p.metodo] = (paymentMethodsMap[p.metodo] || 0) + p.montoUSD;
        });
      } else if (v.metodoPago) {
        paymentMethodsMap[v.metodoPago] = (paymentMethodsMap[v.metodoPago] || 0) + v.totalUSD;
      }
    });

    const sortedVentas = vActivas.sort((a,b) => a.fecha.localeCompare(b.fecha));
    const desdeFactura = sortedVentas.length > 0 ? sortedVentas[0].id : 'N/A';
    const hastaFactura = sortedVentas.length > 0 ? sortedVentas[sortedVentas.length - 1].id : 'N/A';
    
    const sortedDevs = dHoy.sort((a,b) => a.fecha.localeCompare(b.fecha));
    const desdeNC = sortedDevs.length > 0 ? sortedDevs[0].id : 'N/A';
    const hastaNC = sortedDevs.length > 0 ? sortedDevs[sortedDevs.length - 1].id : 'N/A';

    const relevantDiario = (state.libroDiario || []).filter(e => e.fecha > corteTimestamp && e.referencia.includes(termId));
    const totalSalidasCaja = relevantDiario.filter(e => e.tipo === 'egreso').reduce((s, e) => s + e.montoUSD, 0);
    const totalEntradasCaja = relevantDiario.filter(e => e.tipo === 'ingreso' && e.categoria !== 'VENTA' && e.categoria !== 'COBRO_DEUDA').reduce((s, e) => s + e.montoUSD, 0);

    const terminalName = currentTerminal ? currentTerminal.nombre : 'SISTEMA GLOBAL';

    return { 
      brUSD, devUSD, descUSD, netUSD, igtfUSD, ivaUSD, baseImponibleUSD, exentoUSD,
      paymentMethods: paymentMethodsMap,
      manualSalidas: totalSalidasCaja,
      manualEntradas: totalEntradasCaja,
      fondoAperturaUSD: state.fondoCajaHoyUSD || 0,
      fondoAperturaBS: state.fondoCajaHoyBS || 0,
      desdeFactura, hastaFactura, desdeNC, hastaNC,
      stats: { facturas: vActivas.length, devoluciones: dHoy.length, anulaciones: vAnuladas.length, ticketPromedio: vActivas.length > 0 ? (netUSD / vActivas.length) : 0 },
      fecha: Utils.ahora(), terminalName, terminalId: termId, numeroZ: state.ultimoZ + 1, acumuladoHistoricoUSD: state.acumuladoHistorico + netUSD,
      // Total explícito en USD del día (ventas brutas, antes de descuentos/devoluciones).
      // Se calcula como suma de v.totalUSD: cada venta ya tiene su total en USD
      // (los pagos en BS se convierten internamente con la tasa del momento).
      // Esto es lo que el usuario pidió agregar a los Reportes X/Z.
      totalVentasUSD: brUSD,
      tasaBCV: state.tasa || 0
    };
  };

  const [reportLoading, setReportLoading] = useState(false);

  const handleOpenReport = async (type: 'REPORT_X' | 'REPORT_Z') => {
    // Si el reporte ya está abierto, no hacer nada.
    if (showReportType) return;
    setReportLoading(true);
    try {
      // Garantiza que ventas/devoluciones/libroDiario/etc. estén cargados
      // desde Firestore antes de calcular. Evita el bug de "$0" tras reinicio
      // o corte de luz, donde el cache aún no terminó de hidratarse.
      await Store.ensureReportData();
      const data = getFreshReportData();
      setReportSnapshot(data);
      setShowReportType(type);
    } catch (e) {
      console.error('Error abriendo reporte X/Z:', e);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos del reporte. Reintenta.' });
    } finally {
      setReportLoading(false);
    }
  };

  const ejecutarCierreZ = () => {
    const data = reportSnapshot;
    if (!data) return;
    const ahora = Utils.ahora();
    const numeroZ = state.ultimoZ + 1;
    const nuevoZ: ReportZ = {
      id: 'Z-' + String(numeroZ).padStart(6, '0'), fecha: ahora, numeroZ, terminalName: data.terminalName,
      desdeFactura: data.desdeFactura, hastaFactura: data.hastaFactura, desdeNotaCredito: data.desdeNC, hastaNotaCredito: data.hastaNC,
      cantidadAnuladas: data.stats.anulaciones, ventaBrutaUSD: data.brUSD, descuentoUSD: data.descUSD, devolucionesUSD: data.devUSD,
      ventaNetaUSD: data.netUSD, baseImponibleUSD: data.baseImponibleUSD, ivaUSD: data.ivaUSD, exentoUSD: data.exentoUSD,
      igtfUSD: data.igtfUSD, metodosPago: { ...data.paymentMethods }, salidasCajaUSD: data.manualSalidas, entradasCajaUSD: data.manualEntradas,
      fondoAperturaUSD: data.fondoAperturaUSD, fondoAperturaBS: data.fondoAperturaBS, acumuladoHistoricoUSD: data.acumuladoHistoricoUSD, stats: { ...data.stats }
    };
    
    if (typeof localStorage !== 'undefined') localStorage.removeItem('posven_apertura_done');
    
    updateState({ reportesZ: [...(state.reportesZ || []), nuevoZ], ultimoZ: numeroZ, fechaUltimoZ: ahora, acumuladoHistorico: data.acumuladoHistoricoUSD, fondoCajaHoyBS: 0, fondoCajaHoyUSD: 0 });
    toast({ title: `Cierre Fiscal Z #${numeroZ} Exitoso` });
    setShowReportType(null);
  };

  const groupedCredits = useMemo(() => {
    const groups: Record<string, { totalUSD: number; debts: Debt[] }> = {};
    (state.cxc || []).filter(x => x.estado !== 'pagada').forEach(debt => {
      const name = debt.cliente || 'DESCONOCIDO';
      if (!groups[name]) groups[name] = { totalUSD: 0, debts: [] };
      groups[name].totalUSD += debt.saldoUSD;
      groups[name].debts.push(debt);
    });
    return groups;
  }, [state.cxc]);

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

  const subtotalUSD = state.carrito.reduce((s, i) => s + i.subtotalUSD, 0);
  const totalBS = subtotalUSD * state.tasa;
  const totalPagadoUSD = pagos.reduce((s, p) => s + p.montoUSD, 0);
  const saldoRestanteUSD = Math.max(0, subtotalUSD - totalPagadoUSD);

  const matches = search.trim().length > 0 
    ? state.productos.filter(p => p.activo && (p.nombre.toLowerCase().includes(search.toLowerCase()) || p.codigo.toLowerCase().includes(search.toLowerCase()))).slice(0, 8)
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
      const totalPagadoRecibido = listadoPagos.reduce((s, p) => s + p.montoUSD, 0);
      const terminal = getCurrentTerminal();
      const nextNum = terminal?.proximoRecibo || state.proximoRecibo;
      const reciboId = String(nextNum).padStart(9, '0');
      const ahoraStr = Utils.ahora();
      
      let vExento = 0, vBase = 0, vIVA = 0;
      let prodsActualizados = [...state.productos], nuevosMovimientos: Movimiento[] = [];

      state.carrito.forEach(item => {
        const pIdx = prodsActualizados.findIndex(x => x.id === item.productoId);
        if (pIdx === -1) return;
        const p = { ...prodsActualizados[pIdx] };
        if (p.aplicaIVA) { const base = item.subtotalUSD / 1.16; vBase += base; vIVA += (item.subtotalUSD - base); } else { vExento += item.subtotalUSD; }
        if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
          p.kitItems.forEach(ki => {
            const cpIdx = prodsActualizados.findIndex(cp => cp.id === ki.productoId);
            if (cpIdx !== -1) {
              const cp = { ...prodsActualizados[cpIdx] };
              const qty = item.cantidad * ki.cantidad, stockAntes = cp.stock;
              cp.stock -= qty;
              nuevosMovimientos.push({ id: Store.uid(), productoId: cp.id, tipo: 'venta', cantidad: -qty, stockAntes, stockDespues: cp.stock, fecha: ahoraStr, referencia: `KIT: ${p.nombre} - VENTA ${reciboId}`, terminalId: terminal?.id || 'GLOBAL' });
              prodsActualizados[cpIdx] = cp;
            }
          });
        } else {
          const stockAntes = p.stock;
          p.stock -= item.cantidad;
          nuevosMovimientos.push({ id: Store.uid(), productoId: item.productoId, tipo: 'venta', cantidad: -item.cantidad, stockAntes, stockDespues: p.stock, fecha: ahoraStr, referencia: `VENTA ${reciboId}`, terminalId: terminal?.id || 'GLOBAL' });
          prodsActualizados[pIdx] = p;
        }
      });

      const vIgtf = listadoPagos.filter(p => p.metodo === 'efectivo_usd' || p.metodo === 'zelle').reduce((acc, p) => acc + (p.montoUSD * 0.03), 0);
      
      const nuevaVenta: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente, 
        items: [...state.carrito], 
        subtotalUSD, 
        descuentoUSD: 0, 
        totalUSD: subtotalUSD, 
        totalBS, 
        metodoPago: listadoPagos.length > 1 ? 'mixto' : (listadoPagos[0]?.metodo || 'efectivo_usd'), 
        estado: 'completada', 
        type: 'VENTA', 
        received: totalPagadoRecibido, 
        change: Math.max(0, totalPagadoRecibido - subtotalUSD), 
        payments: [...listadoPagos], 
        terminalId: terminal?.id, 
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL', 
        cajeroId: auth?.currentUser?.uid, 
        baseImponibleUSD: Utils.round(vBase), 
        ivaUSD: Utils.round(vIVA), 
        exentoUSD: Utils.round(vExento), 
        igtfUSD: Utils.round(vIgtf),
        tasa: state.tasa
      };
      
      const nuevasEntradasDiario: LibroDiarioEntry[] = listadoPagos.map(p => ({ id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5), fecha: ahoraStr, tipo: 'ingreso', categoria: 'VENTA', concepto: `VENTA #${reciboId} - CLIENTE: ${cliente.toUpperCase()}`, montoUSD: p.montoUSD, montoBS: p.montoBS, metodo: p.metodo, referencia: reciboId + '-' + (terminal?.id || 'GLOBAL') }));
      await updateState({ productos: prodsActualizados, ventas: [...state.ventas, nuevaVenta], movimientos: [...state.movimientos, ...nuevosMovimientos], libroDiario: [...nuevasEntradasDiario, ...(state.libroDiario || [])], carrito: [], proximoRecibo: state.proximoRecibo + 1, terminales: state.terminales.map(t => t.id === terminal?.id ? { ...t, proximoRecibo: t.proximoRecibo + 1 } : t) });
      setLastProcessedSale(nuevaVenta); setShowReceiptModal(true); setPagos([]); setCliente('Consumidor final'); setSelectedProductDisplay(null);
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
      const ahoraStr = Utils.ahora(), terminal = getCurrentTerminal(), nextNum = terminal?.proximoRecibo || state.proximoRecibo, reciboId = 'PAY-' + String(nextNum).padStart(6, '0');
      const nuevasDeudas: Debt[] = state.cxc.map(d => {
        if (d.id === showAbonoModal.id) {
          const nuevoSaldo = Math.max(0, d.saldoUSD - totalAbonado);
          const updated: Debt = { 
            ...d, 
            abonadoUSD: d.abonadoUSD + totalAbonado, 
            saldoUSD: nuevoSaldo, 
            estado: (nuevoSaldo <= 0.001 ? 'pagada' : 'parcial') as 'pagada' | 'parcial', 
            historialPagos: [...(d.historialPagos || []), { fecha: ahoraStr, montoUSD: totalAbonado, montoBS: totalAbonado * state.tasa, metodo: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo, reciboId }] 
          };
          return updated;
        }
        return d;
      });
      const nuevosAsientos: LibroDiarioEntry[] = pagosAbono.map(p => ({ id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5), fecha: ahoraStr, tipo: 'ingreso', categoria: 'COBRO_DEUDA', concepto: `ABONO DEUDA #${showAbonoModal.id} - CLIENTE: ${showAbonoModal.cliente?.toUpperCase()}`, montoUSD: p.montoUSD, montoBS: p.montoBS, metodo: p.metodo, referencia: reciboId + '-' + (terminal?.id || 'GLOBAL') }));
      
      const saleAbono: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente: showAbonoModal.cliente || 'CLIENTE', 
        items: [{ productoId: 'ABONO', nombre: `ABONO A FACTURA #${showAbonoModal.id}`, cantidad: 1, precioUnitUSD: totalAbonado, subtotalUSD: totalAbonado }], 
        subtotalUSD: totalAbonado, 
        descuentoUSD: 0, 
        totalUSD: totalAbonado, 
        totalBS: totalAbonado * state.tasa, 
        metodoPago: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo, 
        estado: 'completada', 
        type: 'COBRO DEUDA', 
        payments: [...pagosAbono], 
        terminalId: terminal?.id, 
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        tasa: state.tasa
      };
      
      await updateState({ cxc: nuevasDeudas, libroDiario: [...nuevosAsientos, ...(state.libroDiario || [])], proximoRecibo: state.proximoRecibo + 1, ventas: [...state.ventas, saleAbono], terminales: state.terminales.map(t => t.id === terminal?.id ? { ...t, proximoRecibo: t.proximoRecibo + 1 } : t) });
      setLastProcessedSale(saleAbono); setShowReceiptModal(true); setShowAbonoModal(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const ejecutarVentaACredito = async () => {
    if (state.carrito.length === 0 || isProcessing) return;
    let targetClient: Customer | null = selectedClient;
    if (showNewClientForm) {
      if (!newClient.name || !newClient.cedula) return alert("Datos incompletos.");
      const fullId = `${newClient.tipoDoc}-${newClient.cedula}`;
      targetClient = { id: Store.uid(), name: newClient.name.toUpperCase(), cedula: fullId, phone: newClient.phone, address: newClient.address, debt: 0 };
    }
    if (!targetClient) return alert("Seleccione un cliente.");
    
    setIsProcessing(true);
    try {
      const terminal = getCurrentTerminal(), nextNum = terminal?.proximoRecibo || state.proximoRecibo, reciboId = String(nextNum).padStart(9, '0'), ahoraStr = Utils.ahora();
      let vExento = 0, vBase = 0, vIVA = 0, prodsActualizados = [...state.productos], nuevosMovimientos: Movimiento[] = [];
      state.carrito.forEach(item => {
        const pIdx = prodsActualizados.findIndex(x => x.id === item.productoId);
        if (pIdx === -1) return;
        const p = { ...prodsActualizados[pIdx] };
        if (p.aplicaIVA) { const base = item.subtotalUSD / 1.16; vBase += base; vIVA += (item.subtotalUSD - base); } else { vExento += item.subtotalUSD; }
        if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
          p.kitItems.forEach(ki => {
            const cpIdx = prodsActualizados.findIndex(cp => cp.id === ki.productoId);
            if (cpIdx !== -1) {
              const cp = { ...prodsActualizados[cpIdx] };
              const qty = item.cantidad * ki.cantidad, stockAntes = cp.stock;
              cp.stock -= qty;
              nuevosMovimientos.push({ id: Store.uid(), productoId: cp.id, tipo: 'venta', cantidad: -qty, stockAntes, stockDespues: cp.stock, fecha: ahoraStr, referencia: `KIT: ${p.nombre} - CRÉDITO ${reciboId}`, terminalId: terminal?.id || 'GLOBAL' });
              prodsActualizados[cpIdx] = cp;
            }
          });
        } else {
          const stockAntes = p.stock;
          p.stock -= item.cantidad;
          nuevosMovimientos.push({ id: Store.uid(), productoId: item.productoId, tipo: 'venta', cantidad: -item.cantidad, stockAntes, stockDespues: p.stock, fecha: ahoraStr, referencia: `CRÉDITO ${reciboId}`, terminalId: terminal?.id || 'GLOBAL' });
          prodsActualizados[pIdx] = p;
        }
      });
      
      const nuevaVenta: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente: targetClient.name, 
        items: [...state.carrito], 
        subtotalUSD, 
        descuentoUSD: 0, 
        totalUSD: subtotalUSD, 
        totalBS, 
        metodoPago: 'credito', 
        estado: 'completada', 
        type: 'VENTA CRÉDITO', 
        received: 0, 
        change: 0, 
        terminalId: terminal?.id, 
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL', 
        cajeroId: auth?.currentUser?.uid, 
        baseImponibleUSD: Utils.round(vBase), 
        ivaUSD: Utils.round(vIVA), 
        exentoUSD: Utils.round(vExento), 
        igtfUSD: 0,
        tasa: state.tasa
      };
      
      const nuevaDeuda: Debt = { id: 'CRD-' + reciboId.slice(-6), fecha: ahoraStr.slice(0, 10), fechaVencimiento: '2099-12-31', cliente: `${targetClient.name} [${targetClient.cedula}]`, montoUSD: subtotalUSD, abonadoUSD: 0, saldoUSD: subtotalUSD, estado: 'pendiente' as 'pendiente', historialPagos: [], ventaId: reciboId };
      await updateState({ 
        productos: prodsActualizados, 
        ventas: [...state.ventas, nuevaVenta], 
        movimientos: [...state.movimientos, ...nuevosMovimientos], 
        cxc: [...state.cxc, nuevaDeuda], 
        clientes: showNewClientForm ? [...(state.clientes || []), { ...targetClient, debt: subtotalUSD }] : (state.clientes || []).map(c => c.id === targetClient!.id ? { ...c, debt: (c.debt || 0) + subtotalUSD } : c), 
        proximoRecibo: state.proximoRecibo + 1, 
        terminales: state.terminales.map(t => t.id === terminal?.id ? { ...t, proximoRecibo: t.proximoRecibo + 1 } : t), 
        carrito: [] 
      });
      setLastProcessedSale(nuevaVenta); setShowReceiptModal(true); setIsCreditView(false); setSelectedClient(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-100px)] max-w-7xl mx-auto w-full overflow-hidden">
      <div className="flex gap-2 no-print shrink-0 overflow-x-auto pb-1 items-center">
        <button onClick={() => setView('pos')} className={`btn btn-sm ${view === 'pos' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ShoppingCart className="w-3.5 h-3.5"/> Punto de Venta</button>
        <button onClick={() => setView('history')} className={`btn btn-sm ${view === 'history' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><History className="w-3.5 h-3.5"/> Historial</button>
        <button onClick={() => setView('credits')} className={`btn btn-sm ${view === 'credits' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ClipboardList className="w-3.5 h-3.5"/> Consultar Créditos</button>
        <button onClick={() => handleOpenReport('REPORT_X')} disabled={reportLoading} className="btn btn-sm bg-white text-ink font-bold border-line border disabled:opacity-50"><FileText className="w-3.5 h-3.5"/> {reportLoading ? 'Cargando…' : 'Reporte X'}</button>
        <button onClick={() => handleOpenReport('REPORT_Z')} disabled={reportLoading} className="btn btn-sm bg-white text-ink font-bold border-line border disabled:opacity-50"><Receipt className="w-3.5 h-3.5"/> {reportLoading ? 'Cargando…' : 'Reporte Z'}</button>
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
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center"><span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">STOCK DISPONIBLE</span><span className={`text-2xl font-black ${selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) ? 'text-status-danger' : selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) * 2 ? 'text-status-warn' : 'text-status-success'}`}>{selectedProductDisplay.stock} <span className="text-xs">UND</span></span></div>
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center"><span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">PRECIO UNITARIO USD</span><span className="text-2xl font-black text-ink">{Utils.fmtUSD(selectedProductDisplay.precioUSD)}</span></div>
                       <div className="p-3 bg-brand-gold-soft/30 border border-brand-gold-soft/30 rounded-xl text-center"><span className="text-[9px] font-black uppercase text-brand-gold-deep block mb-1">EQUIVALENTE EN BOLÍVARES</span><span className="text-2xl font-black text-brand-gold-deep">{Utils.fmtBS(selectedProductDisplay.precioUSD * state.tasa)}</span></div>
                    </div>
                  )}
                  {state.carrito.length > 0 && (
                    <button onClick={() => setIsCreditView(true)} className="w-full h-10 border-2 border-status-info text-status-info hover:bg-status-info-soft font-black uppercase text-[10px] rounded-xl transition-all mt-4">Cargar a Crédito</button>
                  )}
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
              <thead><tr><th>Recibo</th><th>Hora</th><th>Terminal</th><th>Cliente</th><th>Tipo</th><th className="text-right">Monto USD</th><th>Método</th><th className="text-center">Estado</th></tr></thead>
              <tbody>
                {(state.ventas || []).filter(v => v.terminalId === currentTerminal?.id && v.fecha > (state.fechaUltimoZ || '')).sort((a,b) => b.fecha.localeCompare(a.fecha)).map(v => (
                  <tr key={v.id} className="border-b border-line/40 hover:bg-surface-warm/20"><td className="text-ink font-black text-xs mono">{v.id}</td><td className="text-ink font-bold text-xs">{v.fecha.split('T')[1]?.slice(0, 5)}</td><td className="text-ink font-black text-[10px] uppercase">{v.terminalName || state.terminales.find(t => t.id === v.terminalId)?.nombre || '-'}</td><td className="text-ink font-black text-xs uppercase truncate max-w-[150px]">{v.cliente}</td><td className="text-ink font-black text-[9px] uppercase"><span className={`badge ${v.type === 'COBRO DEUDA' ? 'badge-info' : 'badge-neutral'}`}>{v.type || 'VENTA'}</span></td><td className="text-brand-gold-deep font-black text-xs text-right">{Utils.fmtUSD(v.totalUSD)}</td><td className="text-ink font-bold text-[10px] uppercase">{Utils.metodoLabel(v.metodoPago)}</td><td className="text-center"><span className={`badge ${v.estado === 'pendiente' ? 'badge-warn' : (v.estado === 'anulada' ? 'badge-err' : 'badge-ok')} font-black text-[9px] uppercase`}>{v.estado}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : view === 'credits' ? (
        <div className="card flex-1 bg-white flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-300 rounded-xl">
          <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center"><h3 className="text-white font-black uppercase italic tracking-tighter flex items-center gap-2 text-xs"><ClipboardList className="w-5 h-5 text-brand-gold" /> CONSULTA CRÉDITOS Y COBRANZA (GLOBAL)</h3><button onClick={() => setView('pos')} className="btn btn-sm bg-white text-ink hover:bg-surface-soft flex items-center gap-2 font-black uppercase text-[10px] rounded-lg border-none px-4"><ArrowLeft className="w-3.5 h-3.5"/> Volver al POS</button></div>
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
                {Object.entries(groupedCredits).length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-20 text-ink font-black uppercase italic">No hay deudas registradas</td></tr>
                ) : (
                  Object.entries(groupedCredits).map(([clientName, group]) => (
                    <React.Fragment key={clientName}>
                      <tr className="border-b border-line hover:bg-surface-warm/20 transition-colors">
                        <td className="px-6 py-4">
                           <button onClick={() => setExpandedClient(expandedClient === clientName ? null : clientName)} className="text-brand-gold hover:scale-110 transition-transform">{expandedClient === clientName ? <ChevronUp /> : <ChevronDown />}</button>
                        </td>
                        <td className="py-4"><div className="text-ink font-black text-sm uppercase">{clientName}</div></td>
                        <td className="text-right py-4 font-black text-ink">{group.debts.length} Facturas</td>
                        <td className="text-right py-4 font-black text-status-info text-base">{Utils.fmtUSD(group.totalUSD)}</td>
                        <td className="text-right py-4 font-black text-ink">{Utils.fmtBS(group.totalUSD * state.tasa)}</td>
                        <td className="text-center py-4"><button onClick={() => setShowClientHistory(clientName)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5" /></button></td>
                      </tr>
                      {expandedClient === clientName && (
                        <tr className="bg-surface-soft/40 animate-in slide-in-from-top-1 duration-200">
                           <td colSpan={6} className="px-12 py-4">
                              <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                                 <table className="w-full">
                                    <thead className="bg-ink/5"><tr><th className="text-[9px] font-black uppercase p-2 text-left">Emisión</th><th className="text-[9px] font-black uppercase p-2 text-left">Vencimiento</th><th className="text-[9px] font-black uppercase p-2 text-right">Saldo USD</th><th className="text-[9px] font-black uppercase p-2 text-center">Acciones</th></tr></thead>
                                    <tbody>{group.debts.map(d => (<tr key={d.id} className="border-b border-line/20"><td className="text-[10px] font-black p-2">{Utils.fmtFecha(d.fecha)}</td><td className={`text-[10px] font-black p-2 ${d.fechaVencimiento < Utils.hoy() ? 'text-status-danger' : 'text-ink'}`}>{d.fechaVencimiento === '2099-12-31' ? 'ABIERTA' : Utils.fmtFecha(d.fechaVencimiento)}</td><td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td><td className="p-2 text-center"><div className="flex justify-center gap-2"><button onClick={() => setShowDetails(d)} className="w-8 h-8 rounded-full flex items-center justify-center text-status-success hover:bg-status-success/10"><Eye className="w-4 h-4"/></button><button onClick={() => { setShowAbonoModal(d); }} className="btn btn-sm btn-primary h-7 px-3 text-[8px] uppercase">Abonar</button></div></td></tr>))}</tbody>
                                 </table>
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

      {showReceiptModal && (<ReceiptModal isOpen={showReceiptModal} onClose={() => { setShowReceiptModal(false); setLastProcessedSale(null); }} saleData={lastProcessedSale} type="SALE" />)}
      {showReportType && reportSnapshot && (<ReceiptModal isOpen={!!showReportType} onClose={() => { if (showReportType === 'REPORT_Z') ejecutarCierreZ(); setShowReportType(null); }} reportData={reportSnapshot} type={showReportType} />)}
      {showMultiModal && (<FloatingPaymentModal total={totalBS} totalCents={Math.round(totalBS * 100)} exchangeRate={state.tasa} onClose={() => setShowMultiModal(false)} onConfirm={(data) => { ejecutarVenta(data.payments.map(p => ({ metodo: p.method as PaymentMethod, montoUSD: p.usdAmount || (p.amount / state.tasa), montoBS: p.amount }))); setShowMultiModal(false); }} />)}
      {showAbonoModal && (<FloatingPaymentModal total={showAbonoModal.saldoUSD * state.tasa} totalCents={Math.round(showAbonoModal.saldoUSD * state.tasa * 100)} exchangeRate={state.tasa} onClose={() => setShowAbonoModal(null)} allowPartial={true} onConfirm={(data) => { ejecutarAbono(data.payments.map(p => ({ metodo: p.method as PaymentMethod, montoUSD: p.usdAmount || (p.amount / state.tasa), montoBS: p.amount }))); }} />)}

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
                const sale = state.ventas.find(v => v.id === showDetails.ventaId || v.id === showDetails.id);
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
                      {state.cxc.filter(d => d.cliente === showClientHistory).sort((a,b) => b.fecha.localeCompare(a.fecha)).map(d => (
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
                             <button onClick={() => setShowDetails(d)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5"/></button>
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

      {isCreditView && (
        <div className="modal show"><div className="modal-bg" onClick={() => setIsCreditView(false)}></div>
          <div className="modal-box max-w-[380px] bg-white border-2 border-line">
            <div className="modal-head py-3 px-4 border-b border-line bg-surface-soft flex justify-between"><h3 className="text-ink text-xs font-black uppercase tracking-widest flex items-center gap-2"><HandCoins className="w-4 h-4 text-brand-gold" /> CARGAR CRÉDITO</h3><button onClick={() => setIsCreditView(false)}><X size={18} /></button></div>
            <div className="modal-body p-4 space-y-4">
              {!showNewClientForm ? (
                <div className="space-y-3">
                   <div className="bg-ink p-3 rounded-lg text-center mb-2"><p className="text-white/40 text-[8px] font-black uppercase mb-1">Monto a Deber</p><p className="text-2xl font-black text-brand-gold">{Utils.fmtUSD(subtotalUSD)}</p></div>
                   <div className="relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-ink opacity-30" /><input className="form-input pl-10 h-10 text-xs font-bold" placeholder="Buscar cliente..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} /></div>
                   <div className="max-h-[160px] overflow-y-auto border border-line rounded-xl bg-gray-50 shadow-inner">{(filteredClients || []).map(c => (<div key={c.id} onClick={() => setSelectedClient(c)} className={`p-3 border-b border-line/40 cursor-pointer hover:bg-brand-gold-soft transition-all ${selectedClient?.id === c.id ? 'bg-brand-gold-soft border-l-4 border-l-brand-gold' : ''}`}><div className="text-xs font-black text-ink uppercase">{c.name}</div><div className="text-[10px] text-ink/40 mono">{c.cedula}</div></div>))}{filteredClients.length === 0 && <div className="p-10 text-center text-[10px] font-black text-ink/20 uppercase">No hay resultados</div>}</div>
                   <div className="flex flex-col gap-2"><button className="btn bg-status-info-soft text-status-info border border-status-info/40 font-black uppercase text-[10px] h-10 flex items-center justify-center gap-2" onClick={() => setShowNewClientForm(true)}><UserPlus className="w-4 h-4" /> Registrar Nuevo</button><button className="btn btn-primary w-full h-12 font-black uppercase text-xs shadow-md" disabled={!selectedClient || isProcessing} onClick={ejecutarVentaACredito}>{isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}Cargar a Cartera</button></div>
                </div>
              ) : (
                <div className="space-y-4 animate-in slide-in-from-right-2 duration-200">
                  <div className="space-y-2">
                    <div className="space-y-1"><label className="text-[9px] font-black uppercase text-ink">Nombre Completo</label><input className="form-input h-9 text-xs font-black uppercase" value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} /></div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase text-ink">Cédula / Identificación</label>
                      <div className="grid grid-cols-[80px_1fr] gap-1.5 items-center">
                        <select 
                          className="form-select h-9 text-[10px] font-black bg-surface-soft border-line w-full px-1"
                          value={newClient.tipoDoc}
                          onChange={e => setNewClient({ ...newClient, tipoDoc: e.target.value })}
                        >
                          {['V', 'E', 'J', 'G', 'P'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <div className="relative">
                          <Hash className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-ink opacity-30" />
                          <input 
                            className="form-input pl-8 h-9 text-xs font-black w-full" 
                            placeholder="EJ: 13313521"
                            value={newClient.cedula}
                            onChange={e => handleNewClientCedulaChange(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1"><label className="text-[9px] font-black uppercase text-ink">Teléfono (XXXX-XXXXXXX)</label><input className="form-input h-9 text-xs font-black uppercase" value={newClient.phone} onChange={e => setNewClient({...newClient, phone: e.target.value})} placeholder="04XX-XXXXXXX" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black uppercase text-ink">Dirección</label><input className="form-input h-9 text-xs font-black uppercase" value={newClient.address} onChange={e => setNewClient({...newClient, address: e.target.value})} /></div>
                  </div>
                  <button className="btn btn-primary w-full h-12 font-black uppercase text-xs shadow-md" disabled={isProcessing} onClick={ejecutarVentaACredito}>{isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2 inline" /> : null}Guardar y Cargar</button>
                  <button className="text-[10px] text-ink font-black uppercase text-center w-full" onClick={() => setShowNewClientForm(false)}>Volver a la lista</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}