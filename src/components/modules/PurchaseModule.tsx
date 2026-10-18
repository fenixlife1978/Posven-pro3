"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ShoppingBag, 
  Plus, 
  Trash2, 
  Search,
  CheckCircle,
  HandCoins,
  Calendar,
  Layers,
  ArrowRight,
  Info,
  X,
  Trash,
  Boxes,
  Loader2,
  History,
  ChevronDown,
  ChevronUp,
  Receipt,
  Truck
} from 'lucide-react';
import { Store, Utils } from '@/lib/db-store';
import { AppState, Product, Movimiento, PaymentMethod, KitItem, Supplier, LibroDiarioEntry, Debt, PurchaseRecord } from '@/lib/types';
import { ProductFormModal } from '@/components/inventory/ProductFormModal';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, DateRange } from '@/components/ui/date-range-filter';
import { toast } from '@/hooks/use-toast';

interface PurchaseItemTemp {
  productoId: string;
  nombre: string;
  cantidad: number;
  costoUnitarioUSD: number;
  subtotalUSD: number;
}

interface PurchaseModuleProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

export default function PurchaseModule({ state, updateState }: PurchaseModuleProps) {
  const fmt4 = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  const [proveedor, setProveedor] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fecha, setFecha] = useState(Utils.hoy());
  const [tasaCompra, setTasaCompra] = useState<string | number>(state.tasa);
  
  const [condicion, setCondicion] = useState<'contado' | 'credito' | 'mixto'>('contado');
  const [diasPlazo, setDiasPlazo] = useState<string | number>('30');
  const [montoPagadoUSD, setMontoPagadoUSD] = useState<string | number>('0');
  const [montoPagadoBS, setMontoPagadoBS] = useState<string | number>('0');

  const [busqueda, setBusqueda] = useState('');
  const [itemSeleccionado, setItemSeleccionado] = useState<Product | null>(null);
  const [cantidad, setCantidad] = useState<string | number>(1);
  const [costoInput, setCostoInput] = useState<string | number>(0);
  const [loteTemporal, setLoteTemporal] = useState<PurchaseItemTemp[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [confirmProcesar, setConfirmProcesar] = useState(false);

  const [view, setView] = useState<'nueva' | 'historial'>('nueva');
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });
  const [proveedorFiltro, setProveedorFiltro] = useState('');
  const [mesFiltro, setMesFiltro] = useState('');
  const [expandedCompra, setExpandedCompra] = useState<string | null>(null);
  const [histPage, setHistPage] = useState(1);

  const safeProveedores = useMemo(() => {
    return (state.proveedores || []).map(p => 
      typeof p === 'string' ? { id: p, nombre: p, rif: '', contacto: '', direccion: '', telefono: '' } : p
    );
  }, [state.proveedores]);

  const totalUSD = loteTemporal.reduce((acc, item) => acc + item.subtotalUSD, 0);
  const tasaActual = parseFloat(tasaCompra.toString()) || 1;

  // ===== HISTORIAL DE COMPRAS =====
  // Compra legada (pre-F2): reconstruida desde movimientos tipo 'compra' + deudas CxP por factura.
  const legacyCompras = useMemo(() => {
    const map = new Map<string, any>();
    const cxpPorFactura = new Map<string, Debt[]>();
    (state.cxp || []).forEach((d: Debt) => {
      if (!d.numeroFactura) return;
      const arr = cxpPorFactura.get(d.numeroFactura) || [];
      arr.push(d);
      cxpPorFactura.set(d.numeroFactura, arr);
    });

    (state.movimientos || []).filter(m => m.tipo === 'compra').forEach(m => {
      const ref = m.referencia || '';
      const factMatch = ref.match(/FACT:\s*([^-]+)/i);
      const provMatch = ref.match(/PROV:\s*(.+)/i);
      const factura = (factMatch ? factMatch[1].trim() : ref.trim()) || 'S/N';
      const proveedor = (provMatch ? provMatch[1].trim() : 'S/D') || 'S/D';
      const fecha = m.fecha.slice(0, 10);
      const key = `${fecha}|${factura}|${proveedor}`;

      if (!map.has(key)) {
        map.set(key, {
          id: 'LEG-' + key.replace(/[^a-zA-Z0-9]/g, ''),
          fecha,
          fechaHora: m.fecha,
          proveedor,
          numeroFactura: factura,
          condicion: 'contado' as const,
          montoUSD: 0,
          pagadoUSD: 0,
          saldoUSD: 0,
          items: [] as any[],
        });
      }
      const rec = map.get(key);
      const p = state.productos.find(prod => prod.id === m.productoId);
      const costo = p?.costoUSD || 0;
      rec.items.push({
        productoId: m.productoId,
        nombre: p?.nombre || 'ELIMINADO',
        cantidad: m.cantidad,
        costoUnitarioUSD: costo,
        subtotalUSD: Math.round((m.cantidad * costo + Number.EPSILON) * 10000) / 10000,
      });
      rec.montoUSD = Math.round((rec.items.reduce((s: number, i: any) => s + i.subtotalUSD, 0) + Number.EPSILON) * 10000) / 10000;
    });

    map.forEach((rec: any) => {
      const debts = (cxpPorFactura.get(rec.numeroFactura) || []).filter((d: Debt) => d.proveedor === rec.proveedor);
      const debt = debts[0];
      if (debt) {
        rec.condicion = debt.estado === 'pendiente' ? 'credito' : 'mixto';
        rec.montoUSD = debt.montoUSD || 0;
        rec.pagadoUSD = (debt.montoUSD || 0) - (debt.saldoUSD || 0);
        rec.saldoUSD = debt.saldoUSD || 0;
        if (debt.items && debt.items.length > 0) {
          rec.items = debt.items.map((i: any) => ({
            productoId: i.productoId,
            nombre: i.nombre,
            cantidad: i.cantidad,
            costoUnitarioUSD: i.costoUnitarioUSD || 0,
            subtotalUSD: i.subtotalUSD || Math.round((i.cantidad * (i.costoUnitarioUSD || 0)) * 10000) / 10000,
          }));
          rec.montoUSD = debt.montoUSD || 0;
        }
      }
    });

    return Array.from(map.values());
  }, [state.movimientos, state.cxp, state.productos]);

  const todasCompras = useMemo<PurchaseRecord[]>(() => {
    // Una compra registrada en Turso puede aparecer también en legacyCompras
    // porque su movimiento de inventario ya existe. El registro canónico de
    // compras debe prevalecer para no mostrarla dos veces.
    const map = new Map<string, PurchaseRecord>();
    const keyOf = (c: any) => {
      // El ID no sirve para deduplicar aquí: una misma compra puede tener
      // un ID canónico en "compras" y otro ID sintético en legacyCompras.
      // Factura + proveedor + fecha identifican la operación comercial.
      const fecha = String(c?.fecha || '').slice(0, 10);
      const factura = String(c?.numeroFactura || '').trim().toLowerCase();
      const proveedor = String(c?.proveedor || '').trim().toLowerCase();
      if (factura && proveedor && fecha) return `${fecha}|${factura}|${proveedor}`;
      return `ID|${String(c?.id || '')}`;
    };

    // Primero entra la reconstrucción histórica y luego el registro canónico
    // de Turso. Así una compra nueva reemplaza a su copia reconstruida desde
    // el movimiento de Kardex, en vez de sumarse como una segunda compra.
    (legacyCompras || []).forEach((c: any) => map.set(keyOf(c), c));
    (state.compras || []).forEach((c: any) => map.set(keyOf(c), c));

    return Array.from(map.values());
  }, [legacyCompras, state.compras]);

  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>();
    todasCompras.forEach(c => {
      const mes = String(c.fecha || '').slice(0, 7);
      if (/^\\d{4}-\\d{2}$/.test(mes)) set.add(mes);
    });
    return Array.from(set).sort().reverse();
  }, [todasCompras]);

  // El selector de proveedor del historial debe leer el catálogo real de proveedores,
  // no solamente los proveedores que ya aparecen en compras. Así funciona igual que
  // el selector de "Nueva Compra".
  const proveedoresDisponibles = useMemo(() => {
    const set = new Set<string>();
    safeProveedores.forEach(p => {
      const nombre = String(p.nombre || '').trim();
      if (nombre) set.add(nombre);
    });
    // Conserva también proveedores históricos que pudieran no estar ya en el catálogo.
    todasCompras.forEach(c => {
      const nombre = String(c.proveedor || '').trim();
      if (nombre) set.add(nombre);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [safeProveedores, todasCompras]);

  const comprasFiltradas = useMemo(() => {
    const desde = String(rango.desde || '').slice(0, 10);
    const hasta = String(rango.hasta || '').slice(0, 10);
    const proveedorNormalizado = proveedorFiltro.trim().toLocaleLowerCase();
    return todasCompras
      .filter(c => {
        const fechaCompra = String(c.fecha || '').slice(0, 10);
        return (!desde || fechaCompra >= desde) && (!hasta || fechaCompra <= hasta);
      })
      .filter(c => !proveedorNormalizado || String(c.proveedor || '').trim().toLocaleLowerCase() === proveedorNormalizado)
      .filter(c => !mesFiltro || String(c.fecha || '').slice(0, 7) === mesFiltro)
      .sort((a, b) => (b.fechaHora || b.fecha).localeCompare(a.fechaHora || a.fecha));
  }, [todasCompras, rango, proveedorFiltro, mesFiltro]);

  const handleRangoChange = (nuevoRango: DateRange) => {
    const desde = String(nuevoRango.desde || '').slice(0, 10);
    const hasta = String(nuevoRango.hasta || '').slice(0, 10);
    setRango({ desde, hasta });
    setHistPage(1);
  };

  const totalComprasUSD = comprasFiltradas.reduce((s, c) => s + (c.montoUSD || 0), 0);
  const totalPagadoUSD = comprasFiltradas.reduce((s, c) => s + (c.pagadoUSD || 0), 0);
  const totalSaldoUSD = comprasFiltradas.reduce((s, c) => s + (c.saldoUSD || 0), 0);

  const histPageSize = 10;
  const histTotalPages = Math.max(1, Math.ceil(comprasFiltradas.length / histPageSize));
  const histSafePage = Math.min(histPage, histTotalPages);
  const histPageCompras = comprasFiltradas.slice((histSafePage - 1) * histPageSize, histSafePage * histPageSize);

  useEffect(() => {
    if (view !== 'historial') return;
    void Store.ensurePurchaseHistory().catch(() => {});
  }, [view]);

  useEffect(() => {
    if (condicion === 'contado') {
      setMontoPagadoUSD(totalUSD.toFixed(4));
      setMontoPagadoBS((totalUSD * tasaActual).toFixed(2));
    } else if (condicion === 'credito') {
      setMontoPagadoUSD('0');
      setMontoPagadoBS('0');
    }
  }, [condicion, totalUSD, tasaActual]);

  const pMontoPagadoUSD = parseFloat(montoPagadoUSD.toString()) || 0;
  const saldoPendienteUSD = Math.max(0, totalUSD - pMontoPagadoUSD);

  const handleMontoUSDChange = (val: string) => {
    if (!/^\d*\.?\d*$/.test(val)) return;
    setMontoPagadoUSD(val);
    const nUSD = parseFloat(val) || 0;
    setMontoPagadoBS((nUSD * tasaActual).toFixed(2));
  };

  const handleMontoBSChange = (val: string) => {
    if (!/^\d*\.?\d*$/.test(val)) return;
    setMontoPagadoBS(val);
    const nBS = parseFloat(val) || 0;
    setMontoPagadoUSD((nBS / tasaActual).toFixed(4));
  };

  const matches = useMemo(() => {
    if (busqueda.trim().length < 2) return [];
    return state.productos.filter(p => 
      p.activo && 
      (p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || p.codigo.toLowerCase().includes(busqueda.toLowerCase()))
    ).slice(0, 5);
  }, [busqueda, state.productos]);

  const handleSelectItem = (p: Product) => {
    setItemSeleccionado(p);
    setCostoInput(p.costoUSD);
    setBusqueda('');
  };

  const handleAddTempItem = () => {
    const pCant = parseFloat(cantidad.toString()) || 0;
    const pCosto = parseFloat(costoInput.toString()) || 0;
    if (!itemSeleccionado || pCant <= 0 || pCosto <= 0) return;
    
    const nuevo: PurchaseItemTemp = {
      productoId: itemSeleccionado.id,
      nombre: itemSeleccionado.nombre,
      cantidad: pCant,
      costoUnitarioUSD: pCosto,
      subtotalUSD: Math.round((pCant * pCosto + Number.EPSILON) * 10000) / 10000
    };

    setLoteTemporal([...loteTemporal, nuevo]);
    setItemSeleccionado(null);
    setCantidad(1);
    setCostoInput(0);
  };

  const handleRemoveTempItem = (idx: number) => {
    setLoteTemporal(loteTemporal.filter((_, i) => i !== idx));
  };

  const handleProcessPurchase = async () => {
    if (!proveedor) return alert('Seleccione un proveedor');
    if (!numeroFactura) return alert('Ingrese el número de factura');
    if (loteTemporal.length === 0 || isProcessing || processingRef.current) return alert('Agregue productos a la lista');

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const ahoraStr = Utils.ahora();
      // Fecha del movimiento en el kardex = fecha de la compra (puede ser pasada),
      // conservando la hora de registro para que el saldo se recalcule desde ahí.
      const fechaMov = (fecha || Utils.hoy()) + (ahoraStr.includes('T') ? ahoraStr.slice(10) : 'T00:00:00');
      const pDias = parseInt(diasPlazo.toString()) || 0;
      const fechaVencimiento = condicion !== 'contado' ? 
        new Date(new Date(fecha).getTime() + (pDias * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10) : 
        fecha;

      const purchaseId = 'COMP-' + Store.uid().toUpperCase().slice(0, 8);
      const purchaseItems = loteTemporal.map(i => ({ ...i }));
      const paidUSD = pMontoPagadoUSD;
      const saldoUSD = saldoPendienteUSD;

      const paymentId = paidUSD > 0.0001 ? 'PAY-' + Store.uid().toUpperCase().slice(0, 8) : '';
      const journalId = paidUSD > 0.0001 ? 'ACC-' + Store.uid().toUpperCase().slice(0, 8) : '';
      const nuevaDeudaId = saldoUSD > 0.0001 ? 'CXP-' + Store.uid().slice(0, 6).toUpperCase() : '';

      const initialHistory = paidUSD > 0.0001 ? [{
        id: paymentId,
        asientoId: journalId,
        fecha: ahoraStr,
        montoUSD: paidUSD,
        montoBS: paidUSD * tasaActual,
        metodo: 'efectivo_usd',
        reciboId: 'INICIAL-CONTADO'
      }] : [];

      const nuevaDeuda: Debt | undefined = saldoUSD > 0.0001 ? {
        id: nuevaDeudaId,
        fecha: fecha,
        fechaVencimiento: fechaVencimiento,
        proveedor: proveedor,
        concepto: `FACTURA COMPRA #${numeroFactura}`,
        montoUSD: totalUSD,
        abonadoUSD: paidUSD,
        saldoUSD: saldoUSD,
        estado: paidUSD > 0.0001 ? 'parcial' : 'pendiente',
        items: purchaseItems,
        numeroFactura: numeroFactura,
        historialPagos: initialHistory
      } : undefined;

      const nuevaCompra: PurchaseRecord = {
        id: purchaseId,
        fecha: fecha,
        fechaHora: ahoraStr,
        proveedor: proveedor,
        numeroFactura: numeroFactura,
        condicion: condicion,
        montoUSD: totalUSD,
        pagadoUSD: paidUSD,
        saldoUSD: saldoUSD,
        items: purchaseItems,
        terminalId: 'ADMIN'
      };

      const asientoCompra: LibroDiarioEntry | undefined = paidUSD > 0.0001 ? {
        id: journalId,
        fecha: ahoraStr,
        tipo: 'egreso',
        categoria: 'COMPRA',
        concepto: `COMPRA MERCANCIA FACT #${numeroFactura} - PROV: ${proveedor.toUpperCase()}`,
        montoUSD: paidUSD,
        montoBS: paidUSD * tasaActual,
        metodo: 'efectivo_usd',
        referencia: numeroFactura,
        terminalId: 'ADMIN'
      } : undefined;

      const resultCompra = await Store.createPurchaseTransaction({
        purchase: nuevaCompra,
        items: purchaseItems,
        purchaseDate: fecha,
        purchaseDateTime: fechaMov,
        supplier: proveedor,
        invoiceNumber: numeroFactura,
        condition: condicion,
        exchangeRate: tasaActual,
        paidUSD,
        dueDate: fechaVencimiento,
        journal: asientoCompra,
        debt: nuevaDeuda
      });

      if (resultCompra?.queuedOffline) { toast({ title: 'Compra guardada sin conexión', description: 'Quedó pendiente y se sincronizará automáticamente al regresar Internet.' }); return; }
      // Turso ya actualizó el producto dentro de la misma transacción.
      // No volvemos a sumar la compra en el cliente: eso duplicaba el stock.
      updateState({
        compras: [...(state.compras || []), nuevaCompra],
        ...(Array.isArray(resultCompra?.products) && resultCompra.products.length
          ? { productos: mergeById(state.productos || [], resultCompra.products) }
          : {})
      });
      toast({ title: "Compra Registrada ✅", description: `Factura ${numeroFactura} guardada en Turso de forma transaccional.` });
      
      setProveedor('');
      setNumeroFactura('');
      setFecha(Utils.hoy());
      setLoteTemporal([]);
      setCondicion('contado');
    } catch (err: any) {
      console.error('❌ Error procesando compra:', err);
      toast({ title: "Error al guardar compra", description: err?.message || 'Turso no confirmó la persistencia de la compra', variant: "destructive", duration: 8000 });
      // NO limpiar formulario: usuario puede reintentar
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Reduce o elimina un asiento contable al revertir un abono/compra. Devuelve el
  // libro diario actualizado: si el asiento queda en 0 se elimina por completo,
  // de lo contrario (asiento consolidado) se reduce por el monto revertido.
  const revertirAsiento = (diario: LibroDiarioEntry[], asientoId: string, montoUSD: number, montoBS: number): LibroDiarioEntry[] => {
    const asiento = diario.find(e => e.id === asientoId);
    if (!asiento) return diario;
    const resto = Math.round((asiento.montoUSD - montoUSD + Number.EPSILON) * 100) / 100;
    const restoBS = Math.round((asiento.montoBS - montoBS + Number.EPSILON) * 100) / 100;
    if (resto <= 0.001) return diario.filter(e => e.id !== asientoId);
    return diario.map(e => e.id === asientoId ? { ...e, montoUSD: resto, montoBS: Math.max(0, restoBS) } : e);
  };

  // Elimina (revierte) una compra del historial: quita sus movimientos de kardex y
  // recompone stock + costo CPP, revierte los asientos contables (COMPRA y pagos de
  // la CxP asociada) y elimina la compra y su(s) cuenta(s) por pagar generadas.
  const handleEliminarCompra = async (compra: PurchaseRecord) => {
    const normFact = String(compra.numeroFactura || '').trim();
    const normProv = String(compra.proveedor || '').trim();
    if (!normFact || !normProv) {
      return alert('No se pudo identificar la compra para eliminar.');
    }
    if (processingRef.current) return;

    const deudasVinculadas = (state.cxp || []).filter(d =>
      String(d.numeroFactura || '') === normFact &&
      String(d.proveedor || '') === normProv &&
      String(d.fecha || '').slice(0, 10) === String(compra.fecha || '').slice(0, 10)
    );

    const txtDeudas = deudasVinculadas.length > 0
      ? `${deudasVinculadas.length} cuenta(s) por pagar y sus abonos`
      : 'ninguna cuenta por pagar';

    if (!confirm(`¿SEGURO QUE DESEA ELIMINAR LA COMPRA?\\n\\nFactura #${normFact} · ${normProv}\\nCondición: ${String(compra.condicion || '').toUpperCase()} · Total: ${Utils.fmtUSD(compra.montoUSD || 0)}\\n\\nSe revertirán en una operación protegida contra cambios de otras cajas:\\n• Movimientos de inventario de esta factura\\n• Stock y costo CPP afectados\\n• Asientos contables de compra y sus abonos\\n• ${txtDeudas}\\n\\nEsta acción es IRREVERSIBLE.`)) return;

    processingRef.current = true;
    setIsProcessing(true);
    try {
      const result = await Store.deletePurchaseTransaction({
        purchaseId: compra.id,
        invoiceNumber: normFact,
        supplier: normProv,
        purchaseDate: compra.fecha
      });

      if (result?.queuedOffline) { toast({ title: 'Eliminación guardada sin conexión', description: 'Quedó pendiente de sincronización.' }); return; }
      toast({
        title: "Compra eliminada",
        description: `Factura #${normFact} revertida de forma segura (${result?.deletedMovements || 0} movimientos, ${result?.deletedDebts || 0} CxP).`
      });
      setExpandedCompra(null);
    } catch (err: any) {
      console.error('❌ Error revirtiendo compra:', err);
      toast({
        title: "No se pudo eliminar la compra",
        description: err?.message || 'La compra cambió en otra caja. Actualice el historial e inténtelo nuevamente.',
        variant: "destructive",
        duration: 8000
      });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <ShoppingBag className="text-brand-gold" /> REGISTRO DE ENTRADAS POR COMPRA
          </h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Control de Abastecimiento y Costos CPP</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setView('nueva'); }} className={`btn ${view === 'nueva' ? 'btn-primary' : 'btn-secondary'} h-10 px-5 font-black uppercase text-[10px] flex items-center gap-2 shadow-sm`}>
            <Plus className="w-4 h-4" /> Nueva Compra
          </button>
          <button onClick={() => { setView('historial'); setHistPage(1); }} className={`btn ${view === 'historial' ? 'btn-primary' : 'btn-secondary'} h-10 px-5 font-black uppercase text-[10px] flex items-center gap-2 shadow-sm`}>
            <History className="w-4 h-4" /> Historial de Compras
          </button>
        </div>
      </div>

      {view === 'nueva' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Info className="w-5 h-5 text-brand-gold" /> DATOS DE LA FACTURA
              </h3>
            </div>
            <div className="card-body p-6 space-y-4">
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Proveedor</label>
                <select className="form-select h-11 text-xs font-bold" value={proveedor} onChange={e => setProveedor(e.target.value)}>
                  <option value="">SELECCIONE PROVEEDOR</option>
                  {safeProveedores.map(p => (
                    <option key={p.id} value={p.nombre}>{p.nombre?.toUpperCase() || 'S/N'}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Fecha de la Factura</label>
                <input type="date" className="form-input h-11 text-sm font-black" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">N° Factura</label>
                  <input className="form-input h-11 text-sm font-black" value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)} placeholder="000123" />
                </div>
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Tasa Aplicada</label>
                  <input type="number" className="form-input h-11 text-brand-gold-deep font-black" value={tasaCompra} onChange={e => setTasaCompra(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-surface-soft border-b border-line px-6 py-3 flex justify-center gap-2">
                {['contado', 'credito', 'mixto'].map(c => (
                  <button 
                    key={c} 
                    onClick={() => setCondicion(c as any)} 
                    className={`px-6 h-9 rounded-full text-[10px] font-black uppercase transition-all shadow-sm ${condicion === c ? 'bg-brand-gold text-white' : 'bg-white text-ink border border-line hover:bg-surface-warm'}`}
                  >
                    {c}
                  </button>
                ))}
            </div>
            <div className="card-body p-6 space-y-5">
              
              {condicion !== 'contado' && (
                <div className="form-group animate-in slide-in-from-top-2">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Días de Crédito</label>
                  <input 
                    type="number" 
                    className="form-input h-10 text-center font-black" 
                    value={diasPlazo} 
                    onChange={e => setDiasPlazo(e.target.value)} 
                  />
                </div>
              )}

              {condicion === 'mixto' && (
                <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2">
                   <div className="form-group">
                      <label className="text-ink text-[9px] font-black uppercase block mb-1">Pagado ($)</label>
                      <input 
                        className="form-input h-10 text-sm font-black text-status-success" 
                        value={montoPagadoUSD} 
                        onChange={e => handleMontoUSDChange(e.target.value)} 
                      />
                   </div>
                   <div className="form-group">
                      <label className="text-ink text-[9px] font-black uppercase block mb-1">Pagado (Bs)</label>
                      <input 
                        className="form-input h-10 text-sm font-black text-ink" 
                        value={montoPagadoBS} 
                        onChange={e => handleMontoBSChange(e.target.value)} 
                      />
                   </div>
                </div>
              )}

              <div className="space-y-3 pt-2 border-t border-line/50">
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-40">TOTAL FACTURA:</span>
                  <span className="text-ink text-base">{fmt4(totalUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-40">PAGADO HOY:</span>
                  <span className="text-status-success text-base">{fmt4(pMontoPagadoUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase border-t border-line/50 pt-3">
                  <span className="text-ink opacity-40">SALDO PENDIENTE:</span>
                  <span className="text-status-danger text-lg">{fmt4(saldoPendienteUSD)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <button onClick={() => setShowNewProductModal(true)} className="p-1 hover:bg-white/10 rounded transition-colors">
                     <Plus className="w-5 h-5 text-brand-gold" />
                   </button>
                   <h3 className="text-white font-black text-xs uppercase italic tracking-tighter">ADICIÓN DE ÍTEMS AL LOTE</h3>
                </div>
            </div>
            <div className="card-body p-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="md:col-span-6 relative">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Buscar Producto Existente</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-brand-gold" />
                    <input className="form-input pl-10 h-11 bg-surface-soft border-line" placeholder="Nombre o Código..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                  </div>
                  {matches.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-line rounded shadow-2xl z-[100] mt-1 overflow-hidden">
                      {matches.map(p => (
                        <div key={p.id} onClick={() => handleSelectItem(p)} className="p-3 border-b border-line hover:bg-brand-gold/10 cursor-pointer flex justify-between items-center transition-colors">
                          <div className="flex flex-col"><span className="text-xs font-black text-ink uppercase">{p.nombre}</span><span className="text-[9px] text-ink/40 mono">{p.codigo}</span></div>
                          <div className="text-brand-gold-deep font-black text-xs">${p.costoUSD.toFixed(4)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2 text-center">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Cant.</label>
                  <input type="number" className="form-input h-11 text-center font-black bg-surface-soft border-line" value={cantidad} onChange={e => setCantidad(e.target.value)} />
                </div>
                <div className="md:col-span-2 text-center">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Costo $</label>
                  <input type="number" className="form-input h-11 text-center font-black bg-surface-soft border-line text-brand-gold-deep" value={costoInput} onChange={e => setCostoInput(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <button onClick={handleAddTempItem} disabled={!itemSeleccionado} className="btn btn-primary w-full h-11 shadow-md disabled:opacity-20 flex items-center justify-center"><Plus className="w-5 h-5"/></button>
                </div>
              </div>
            </div>

            <div className="table-wrap border-t border-line">
              <table className="bg-white">
                <thead className="bg-surface-soft">
                  <tr>
                    <th className="font-black text-ink uppercase text-[10px] py-4 px-6">Producto</th>
                    <th className="font-black text-ink uppercase text-[10px] text-center">Cant</th>
                    <th className="font-black text-ink uppercase text-[10px] text-right">Costo Unit.</th>
                    <th className="font-black text-ink uppercase text-[10px] text-right">Subtotal</th>
                    <th className="font-black text-ink uppercase text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {loteTemporal.map((item, idx) => (
                    <tr key={idx} className="border-b border-line/30 hover:bg-surface-warm/20">
                      <td className="text-xs font-black text-ink uppercase py-4 px-6">{item.nombre}</td>
                      <td className="text-center font-bold text-ink">{item.cantidad}</td>
                      <td className="text-right font-bold text-ink">{fmt4(item.costoUnitarioUSD)}</td>
                      <td className="text-right font-black text-brand-gold-deep">{fmt4(item.subtotalUSD)}</td>
                      <td className="text-center">
                        <button onClick={() => handleRemoveTempItem(idx)} className="text-ink/20 hover:text-status-danger transition-colors p-2"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {loteTemporal.length === 0 && (
                    <tr><td colSpan={5} className="py-20 text-center text-ink/20 font-black uppercase italic opacity-40">Añada productos al lote de compra para procesar</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card-foot p-6 bg-surface-soft flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4">
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Factura</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(totalUSD)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Equiv. BS</span>
                   <p className="text-lg font-black text-ink leading-none">{Utils.fmtBS(totalUSD * tasaActual)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Pagado USD</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(pMontoPagadoUSD)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Pendiente</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(saldoPendienteUSD)}</p>
                </div>
              </div>
              <button 
                onClick={() => setConfirmProcesar(true)} 
                disabled={loteTemporal.length === 0 || isProcessing} 
                className="btn btn-primary h-14 px-10 font-black uppercase text-xs shadow-xl disabled:opacity-20 transition-all flex items-center gap-3"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Procesar e Importar Inventario
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {view === 'historial' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <Card className="p-5 bg-white border-line shadow-sm rounded-xl no-print">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[320px]">
                <label className="text-[10px] font-black uppercase text-ink/40 block mb-2">CONSULTAR COMPRAS POR PERÍODO</label>
                <DateRangeFilter value={rango} onChange={handleRangoChange} />
              </div>
              <div className="form-group mb-0">
                <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Proveedor</label>
                <select className="form-select h-8 text-[10px] font-black uppercase bg-surface-soft border-line rounded-md" value={proveedorFiltro} onChange={e => setProveedorFiltro(e.target.value)}>
                  <option value="">TODOS LOS PROVEEDORES</option>
                  {proveedoresDisponibles.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Mes</label>
                <select className="form-select h-8 text-[10px] font-black uppercase bg-surface-soft border-line rounded-md" value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}>
                  <option value="">TODOS LOS MESES</option>
                  {mesesDisponibles.map(m => {
                    const [y, mo] = m.split('-');
                    const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
                    return <option key={m} value={m}>{label.toUpperCase()}</option>;
                  })}
                </select>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="kpi bg-white border-line p-5 rounded-2xl shadow-sm border-l-[6px] border-l-brand-gold flex items-center gap-3">
              <div className="p-3 bg-brand-gold-soft rounded-xl"><Truck className="w-5 h-5 text-brand-gold-deep" /></div>
              <div>
                <p className="text-[9px] font-black uppercase text-ink/40">Compras</p>
                <p className="text-xl font-black text-ink">{comprasFiltradas.length}</p>
              </div>
            </div>
            <div className="kpi bg-white border-line p-5 rounded-2xl shadow-sm border-l-[6px] border-l-status-danger flex items-center gap-3">
              <div className="p-3 bg-status-danger-soft rounded-xl"><Receipt className="w-5 h-5 text-status-danger" /></div>
              <div>
                <p className="text-[9px] font-black uppercase text-ink/40">Total Facturado</p>
                <p className="text-xl font-black text-status-danger">{Utils.fmtUSD(totalComprasUSD)}</p>
              </div>
            </div>
            <div className="kpi bg-white border-line p-5 rounded-2xl shadow-sm border-l-[6px] border-l-status-success flex items-center gap-3">
              <div className="p-3 bg-status-success-soft rounded-xl"><CheckCircle className="w-5 h-5 text-status-success" /></div>
              <div>
                <p className="text-[9px] font-black uppercase text-ink/40">Pagado</p>
                <p className="text-xl font-black text-status-success">{Utils.fmtUSD(totalPagadoUSD)}</p>
              </div>
            </div>
            <div className="kpi bg-white border-line p-5 rounded-2xl shadow-sm border-l-[6px] border-l-status-info flex items-center gap-3">
              <div className="p-3 bg-status-info-soft rounded-xl"><HandCoins className="w-5 h-5 text-status-info" /></div>
              <div>
                <p className="text-[9px] font-black uppercase text-ink/40">Saldo Pendiente</p>
                <p className="text-xl font-black text-status-info">{Utils.fmtUSD(totalSaldoUSD)}</p>
              </div>
            </div>
          </div>

          <Card className="shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <History className="w-5 h-5 text-brand-gold" /> HISTORIAL DE COMPRAS DETALLADAS
              </h3>
            </div>
            <div className="table-wrap">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-soft">
                    <TableHead className="text-[10px] font-black uppercase text-left">Fecha</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-left">Factura</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-left">Proveedor</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-center">Condición</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-center">Ítems</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-right">Total USD</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-right">Pagado</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-right">Saldo</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {histPageCompras.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-20 text-ink/20 font-black italic uppercase">No se registran compras para la selección actual</TableCell></TableRow>
                  ) : histPageCompras.map(c => (
                    <React.Fragment key={c.id}>
                      <TableRow className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors cursor-pointer" onClick={() => setExpandedCompra(expandedCompra === c.id ? null : c.id)}>
                        <TableCell className="text-xs font-bold text-ink">{Utils.fmtFecha(c.fecha)}</TableCell>
                        <TableCell className="text-xs font-black mono text-ink">{c.numeroFactura}</TableCell>
                        <TableCell className="text-xs font-black uppercase text-ink">{c.proveedor}</TableCell>
                        <TableCell className="text-center">
                          <span className={`badge ${c.condicion === 'contado' ? 'badge-ok' : (c.condicion === 'credito' ? 'badge-warn' : 'badge-info')} text-[9px] font-black uppercase`}>{c.condicion}</span>
                        </TableCell>
                        <TableCell className="text-center font-black text-ink">{c.items.length}</TableCell>
                        <TableCell className="text-right font-black text-brand-gold-deep">{Utils.fmtUSD(c.montoUSD)}</TableCell>
                        <TableCell className="text-right font-black text-status-success">{Utils.fmtUSD(c.pagadoUSD)}</TableCell>
                        <TableCell className="text-right font-black text-status-danger">{Utils.fmtUSD(c.saldoUSD)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={e => { e.stopPropagation(); handleEliminarCompra(c); }} className="btn-icon h-8 w-8 text-status-danger hover:bg-status-danger/10" title="Eliminar compra y revertir todos sus movimientos">
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); setExpandedCompra(expandedCompra === c.id ? null : c.id); }} className="btn-icon h-8 w-8 text-ink hover:text-brand-gold">
                              {expandedCompra === c.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedCompra === c.id && (
                        <TableRow className="bg-surface-soft/40">
                          <TableCell colSpan={9} className="px-8 py-4">
                            <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                              <table className="w-full">
                                <thead className="bg-ink/5">
                                  <tr>
                                    <th className="text-[9px] font-black uppercase p-2 text-left">Producto</th>
                                    <th className="text-[9px] font-black uppercase p-2 text-center">Cantidad</th>
                                    <th className="text-[9px] font-black uppercase p-2 text-right">Costo Unit. USD</th>
                                    <th className="text-[9px] font-black uppercase p-2 text-right">Subtotal USD</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.items.map((it, idx) => (
                                    <tr key={idx} className="border-b border-line/20">
                                      <td className="text-[10px] font-black uppercase p-2 text-ink">{it.nombre}</td>
                                      <td className="text-[10px] font-black p-2 text-center">{it.cantidad}</td>
                                      <td className="text-[10px] font-bold p-2 text-right mono">{fmt4(it.costoUnitarioUSD)}</td>
                                      <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{fmt4(it.subtotalUSD)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={histSafePage} totalPages={histTotalPages} total={comprasFiltradas.length} pageSize={histPageSize} onPageChange={setHistPage} />
          </Card>
        </div>
      )}

      {confirmProcesar && (
        <div className="modal show"><div className="modal-bg" onClick={() => setConfirmProcesar(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center text-white">
              <h3 className="text-white font-black uppercase text-xs flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-brand-gold" /> CONFIRMAR REGISTRO DE COMPRA
              </h3>
              <button onClick={() => setConfirmProcesar(false)} className="text-white hover:text-brand-gold transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="modal-body p-6 space-y-5 bg-white">
              <div className="p-3 rounded-xl bg-surface-soft border border-line text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-ink/50 mb-1">ESTA COMPRA SE REGISTRARÁ COMO</p>
                <p className="text-2xl font-black uppercase italic text-brand-gold-deep">{condicion}</p>
                <p className="text-[9px] font-black uppercase text-ink/50 mt-1">
                  {condicion === 'contado' ? 'Pago total al contado · No genera cuenta por pagar'
                    : condicion === 'credito' ? `Sin pago inicial · Crédito a ${diasPlazo || 0} días · Genera cuenta por pagar`
                    : 'Pago parcial hoy · El saldo genera cuenta por pagar'}
                </p>
              </div>

              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-50">Proveedor</span>
                  <span className="text-ink">{proveedor}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-50">Factura</span>
                  <span className="text-ink mono">{numeroFactura}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-50">TOTAL FACTURA</span>
                  <span className="text-ink text-sm">{fmt4(totalUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-50">PAGADO HOY</span>
                  <span className="text-status-success text-sm">{fmt4(pMontoPagadoUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase border-t border-line pt-2">
                  <span className="text-ink opacity-50">SALDO A CRÉDITO</span>
                  <span className="text-status-danger text-sm">{fmt4(saldoPendienteUSD)}</span>
                </div>
              </div>

              <p className="text-[10px] font-black text-ink/60 leading-relaxed">
                ¿Confirma que desea finalizar el proceso? Al confirmar se importará el inventario,
                se recalcularán los costos CPP y {saldoPendienteUSD > 0.0001 ? 'se generará la cuenta por pagar' : 'no se generará saldo pendiente'}.
              </p>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setConfirmProcesar(false)} className="btn btn-secondary flex-1 h-12 font-black uppercase text-[10px]">
                  <X className="w-4 h-4" /> Revisar
                </button>
                <button
                  onClick={() => { setConfirmProcesar(false); handleProcessPurchase(); }}
                  disabled={isProcessing}
                  className="btn btn-primary flex-1 h-12 font-black uppercase text-[10px] disabled:opacity-30"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Confirmar y Registrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewProductModal && (
        <ProductFormModal 
          state={state}
          onClose={() => setShowNewProductModal(false)}
          onUpdateLists={(lists) => updateState(lists)}
          onSave={(datos) => {
            const nuevo: Product = {
              ...datos,
              id: Store.uid(),
              fechaCreacion: Utils.hoy(),
              activo: true
            };
            const nuevosProds = [...state.productos, nuevo];
            
            if (nuevo.stock > 0) {
              const mov: Movimiento = {
                id: Store.uid(),
                productoId: nuevo.id,
                tipo: 'inicial',
                cantidad: nuevo.stock,
                stockAntes: 0,
                stockDespues: nuevo.stock,
                fecha: Utils.ahora(),
                referencia: 'INICIAL DESDE COMPRAS',
                terminalId: 'ADMIN'
              };
              updateState({ productos: nuevosProds, movimientos: [...state.movimientos, mov] });
            } else {
              updateState({ productos: nuevosProds });
            }
            toast({ title: "Producto creado ✅", description: `${nuevo.nombre} agregado al inventario.` });
            setShowNewProductModal(false);
          }}
        />
      )}
    </div>
  );
}
