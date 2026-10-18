'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Product, Movimiento, KitItem, Supplier, Return } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Boxes, 
  X, 
  FileText, 
  History, 
  Layers, 
  Box, 
  PlusCircle, 
  MinusCircle, 
  Check, 
  Filter, 
  PackageCheck, 
  AlertCircle,
  Truck,
  Calculator,
  TrendingUp,
  LayoutGrid,
  Monitor,
  Eye,
  ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  generarPDFInventarioSimple, 
  exportarPDFInventarioGeneral, 
  exportarPDFKardex, 
  exportarPDFDevoluciones
} from '@/lib/pdf-generator';
import { ProductFormModal } from '@/components/inventory/ProductFormModal';
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, DateRange } from '@/components/ui/date-range-filter';

export function InventoryModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [activeTab, setActiveTab] = useState('productos');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [selectedKardexId, setSelectedKardexId] = useState<string | null>(null);
  const [selectedCPPId, setSelectedCPPId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    Store.ensureLoaded('movimientos');
    Store.ensureLoaded('ventas');
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, catFilter, deptFilter]);
  
  const [showAjuste, setShowAjuste] = useState<string | null>(null);
  const [showProducto, setShowProducto] = useState<string | null | 'nuevo'>(null);

  // ✅ CORRECCIÓN: Limpiar departamentos y categorías para evitar duplicados
  const cleanDepartamentos = useMemo(() => {
    const depts = (state.departamentos || [])
      .map(d => d?.trim())
      .filter(d => d && d.length > 0);
    return Array.from(new Set(depts));
  }, [state.departamentos]);

  const cleanCategorias = useMemo(() => {
    const cats = (state.categorias || [])
      .map(c => c?.trim())
      .filter(c => c && c.length > 0);
    return Array.from(new Set(cats));
  }, [state.categorias]);

  const prods = (state.productos || []).filter(p => 
    p.activo && 
    ((p.nombre || '').toLowerCase().includes(search.toLowerCase()) || (p.codigo || '').toLowerCase().includes(search.toLowerCase())) &&
    (catFilter ? p.categoria === catFilter : true) &&
    (deptFilter ? p.departamento === deptFilter : true)
  );

  const lowStockCount = prods.filter(p => p.stock <= (p.stockMinimo || 0)).length;

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(prods.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageProds = prods.slice((safePage - 1) * pageSize, safePage * pageSize);

  const eliminar = (id: string) => {
    if (!confirm('¿Seguro que desea eliminar este producto?')) return;
    const nuevos = state.productos.map(p => p.id === id ? { ...p, activo: false } : p);
    updateState({ productos: nuevos });
  };

  const renderContent = () => {
    switch(activeTab) {
      case 'productos': return (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="kpi bg-white border-line p-6 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-brand-gold-soft rounded-xl"><PackageCheck className="w-6 h-6 text-brand-gold-deep" /></div>
              <div>
                <p className="text-[10px] font-black uppercase text-ink/40">Total Productos</p>
                <p className="text-2xl font-black text-ink">{prods.length}</p>
              </div>
            </div>
            <div className={`kpi p-6 rounded-2xl shadow-sm border-l-[6px] flex items-center gap-4 ${lowStockCount > 0 ? 'bg-status-danger-soft border-l-status-danger' : 'bg-white border-line'}`}>
              <div className={`p-3 rounded-xl ${lowStockCount > 0 ? 'bg-status-danger text-white' : 'bg-surface-soft text-ink/20'}`}>
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-ink/40">Stock Bajo</p>
                <p className={`text-2xl font-black ${lowStockCount > 0 ? 'text-status-danger' : 'text-ink'}`}>{lowStockCount}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex flex-wrap gap-4 flex-1 w-full">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-ink/30" />
                <Input 
                  className="pl-9 h-11 text-sm font-bold bg-white border-line" 
                  placeholder="Buscar producto por nombre o código..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)} 
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-ink/30" />
                <select 
                  className="form-select h-11 bg-white border-line text-xs font-black uppercase"
                  value={deptFilter} 
                  onChange={e => setDeptFilter(e.target.value)}
                >
                  <option value="">DEPARTAMENTO</option>
                  {cleanDepartamentos.map((d, index) => (
                    <option key={`dept-${d}-${index}`} value={d}>{d}</option>
                  ))}
                </select>
                <select 
                  className="form-select h-11 bg-white border-line text-xs font-black uppercase"
                  value={catFilter} 
                  onChange={e => setCatFilter(e.target.value)}
                >
                  <option value="">CATEGORÍA</option>
                  {cleanCategorias.map((c, index) => (
                    <option key={`cat-${c}-${index}`} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              <Button variant="secondary" className="flex-1 md:flex-none h-11 font-black uppercase text-[10px]" onClick={() => generarPDFInventarioSimple(prods, state.empresa)}>
                <FileText className="w-4 h-4" /> PDF Simple
              </Button>
              <Button className="flex-1 md:flex-none h-11 bg-brand-gold hover:bg-brand-gold-deep text-ink font-black uppercase text-[10px] shadow-lg" onClick={() => setShowProducto('nuevo')}>
                <Plus className="w-4 h-4" /> Nuevo Ítem
              </Button>
            </div>
          </div>

          <Card className="bg-white border-line shadow-xl rounded-xl overflow-hidden">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4">
               <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                 <Box className="w-5 h-5 text-brand-gold" /> CATÁLOGO MAESTRO DE INVENTARIO
               </h3>
            </div>
            <div className="table-wrap">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-soft">
                    <TableHead className="text-ink font-black uppercase text-[10px]">Código</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px]">Nombre Producto</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px]">Categoría</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px] text-right">Costo ($)</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px] text-right">Venta ($)</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px] text-center">Stock</TableHead>
                    <TableHead className="text-ink font-black uppercase text-[10px] text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-white">
                  {prods.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-20 text-ink/20 font-black italic uppercase">No se encontraron productos coincidentes</TableCell></TableRow>
                  ) : (
                    pageProds.map(p => (
                      <TableRow key={p.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                        <TableCell className="mono text-xs font-black text-ink">{p.codigo}</TableCell>
                        <TableCell className="font-bold text-ink uppercase">
                          <div className="flex items-center gap-2">
                            {p.isKit && <Layers className="w-3.5 h-3.5 text-brand-gold" />}
                            {p.nombre}
                          </div>
                        </TableCell>
                        <TableCell><span className="badge badge-neutral text-ink font-black uppercase text-[9px]">{p.categoria}</span></TableCell>
                        <TableCell className="mono font-bold text-ink/50 text-right">{Utils.fmtUSD(p.costoUSD)}</TableCell>
                        <TableCell className="mono text-brand-gold-deep font-black text-right">{Utils.fmtUSD(p.precioUSD)}</TableCell>
                        <TableCell className="text-center">
                          <span className={`badge ${p.stock <= (p.stockMinimo || 0) ? 'badge-err' : 'badge-neutral'} font-black text-xs min-w-[40px]`}>
                            {p.stock}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <button className="btn-icon h-8 w-8 text-ink hover:text-brand-gold" onClick={() => setShowProducto(p.id)}><Edit2 className="w-4 h-4" /></button>
                            <button className="btn-icon h-8 w-8 text-ink hover:text-status-info" onClick={() => { setSelectedKardexId(p.id); setActiveTab('kardex'); }}><History className="w-4 h-4" /></button>
                            <button className="btn-icon h-8 w-8 text-ink hover:text-status-success" onClick={() => setShowAjuste(p.id)}><Boxes className="w-4 h-4" /></button>
                            <button className="btn-icon h-8 w-8 text-ink hover:text-status-danger" onClick={() => eliminar(p.id)}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <Pagination page={safePage} totalPages={totalPages} total={prods.length} pageSize={pageSize} onPageChange={setPage} />
          </Card>
        </div>
      );
      case 'reporte_general': return (
        <ReporteGeneral 
          state={state} 
          onAction={(type, id) => {
            if (type === 'edit') setShowProducto(id);
            if (type === 'kardex') { setSelectedKardexId(id); setActiveTab('kardex'); }
            if (type === 'adjust') setShowAjuste(id);
            if (type === 'cpp') setSelectedCPPId(id);
          }}
        />
      );
      case 'reporte_ventas': return <ReporteVentas state={state} />;
      case 'reporte_devoluciones': return <ReporteDevoluciones state={state} />;
      case 'historial_ajustes': return <HistorialAjustes state={state} />;
      case 'kardex': return <ReporteKardex state={state} selectedId={selectedKardexId} onSelect={setSelectedKardexId} />;
      case 'consumo_colab': return <ReporteConsumo state={state} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="tabs border-line border-b no-print">
        <button onClick={() => setActiveTab('productos')} className={`tab ${activeTab === 'productos' ? 'active' : 'text-ink font-black'}`}>Productos</button>
        <button onClick={() => setActiveTab('reporte_general')} className={`tab ${activeTab === 'reporte_general' ? 'active' : 'text-ink font-black'}`}>Inventario CPP</button>
        <button onClick={() => setActiveTab('reporte_ventas')} className={`tab ${activeTab === 'reporte_ventas' ? 'active' : 'text-ink font-black'}`}>Ventas</button>
        <button onClick={() => setActiveTab('reporte_devoluciones')} className={`tab ${activeTab === 'reporte_devoluciones' ? 'active' : 'text-ink font-black'}`}>Devoluciones</button>
        <button onClick={() => setActiveTab('kardex')} className={`tab ${activeTab === 'kardex' ? 'active' : 'text-ink font-black'}`}>Kardex Fiscal</button>
        <button onClick={() => setActiveTab('historial_ajustes')} className={`tab ${activeTab === 'historial_ajustes' ? 'active' : 'text-ink font-black'}`}>Ajustes</button>
        <button onClick={() => setActiveTab('consumo_colab')} className={`tab ${activeTab === 'consumo_colab' ? 'active' : 'text-ink font-black'}`}>Consumo / Colaboraciones</button>
      </div>

      <div className="animate-in fade-in duration-300">
        {renderContent()}
      </div>

      {selectedCPPId && (
        <ModalCPP 
          producto={state.productos.find(p => p.id === selectedCPPId)!}
          movimientos={state.movimientos.filter(m => m.productoId === selectedCPPId)}
          onClose={() => setSelectedCPPId(null)}
        />
      )}

      {/* ✅ CORRECCIÓN: Remover isOpen={true} - ProductFormModal no acepta esa prop */}
      {showProducto && (
        <ProductFormModal 
          state={state}
          producto={showProducto === 'nuevo' ? undefined : state.productos.find(p => p.id === showProducto)}
          onClose={() => setShowProducto(null)}
          onUpdateLists={(lists) => updateState(lists)}
          onSave={(datos) => {
            let nuevosProds;
            if (showProducto === 'nuevo') {
              const nuevo: Product = {
                ...datos,
                id: Store.uid(),
                fechaCreacion: Utils.hoy(),
                activo: true
              };
              nuevosProds = [...state.productos, nuevo];
              if (nuevo.stock > 0) {
                const mov: Movimiento = {
                  id: Store.uid(),
                  productoId: nuevo.id,
                  tipo: 'inicial',
                  cantidad: nuevo.stock,
                  stockAntes: 0,
                  stockDespues: nuevo.stock,
                  fecha: Utils.ahora(),
                  referencia: 'INICIAL',
                  terminalId: 'SISTEMA'
                };
                updateState({ productos: nuevosProds, movimientos: [...state.movimientos, mov] });
              } else {
                updateState({ productos: nuevosProds });
              }
            } else {
              nuevosProds = state.productos.map(p => p.id === showProducto ? { ...p, ...datos } : p);
              updateState({ productos: nuevosProds });
            }
            setShowProducto(null);
          }}
        />
      )}

      {showAjuste && (
        <ModalAjuste 
          producto={state.productos.find(p => p.id === showAjuste)!} 
          onClose={() => setShowAjuste(null)}
          onSave={(mov, nuevoCosto) => {
            const productoOriginal = state.productos.find(p => p.id === mov.productoId);
            if (!productoOriginal) return;

            let prodsActualizados = [...state.productos];
            let nuevosMovimientos = [...state.movimientos];

            if (productoOriginal.isKit && productoOriginal.kitType === 'stock_componentes' && productoOriginal.kitItems) {
              productoOriginal.kitItems.forEach(ki => {
                const cpIdx = prodsActualizados.findIndex(cp => cp.id === ki.productoId);
                if (cpIdx !== -1) {
                  const cp = { ...prodsActualizados[cpIdx] };
                  const cantidadImpacto = mov.cantidad * ki.cantidad;
                  const stockAntes = cp.stock;
                  cp.stock += cantidadImpacto; 
                  
                  nuevosMovimientos.push({
                    id: Store.uid(),
                    productoId: cp.id,
                    tipo: mov.tipo,
                    cantidad: cantidadImpacto,
                    stockAntes,
                    stockDespues: cp.stock,
                    fecha: mov.fecha,
                    referencia: `${mov.tipo.replace('_', ' ').toUpperCase()} KIT: ${productoOriginal.nombre} - REF: ${mov.referencia}`,
                    terminalId: 'ADMIN'
                  });
                  prodsActualizados[cpIdx] = cp;
                }
              });
            } else {
              prodsActualizados = prodsActualizados.map(p => {
                if (p.id === mov.productoId) {
                  let finalCosto = p.costoUSD;
                  if (mov.tipo === 'ajuste_entrada' || mov.tipo === 'compra') {
                    const stockActual = p.stock;
                    const cantidadNueva = Math.abs(mov.cantidad);
                    const costoNuevo = nuevoCosto || p.costoUSD;
                    const stockTotal = stockActual + cantidadNueva;
                    if (stockTotal > 0) {
                      finalCosto = Utils.round(((stockActual * p.costoUSD) + (cantidadNueva * costoNuevo)) / stockTotal);
                    }
                  }
                  return { ...p, stock: mov.stockDespues, costoUSD: finalCosto };
                }
                return p;
              });
              nuevosMovimientos.push(mov);
            }

            updateState({ 
              productos: prodsActualizados, 
              movimientos: nuevosMovimientos 
            });
            setShowAjuste(null);
          }}
        />
      )}
    </div>
  );
}

function ReporteGeneral({ state, onAction }: { state: AppState, onAction: (type: string, id: string) => void }) {
  const [deptFilter, setDeptFilter] = useState('');

  const filteredProducts = (state.productos || []).filter(p => 
    p.activo && (deptFilter ? p.departamento === deptFilter : true)
  );

  const totalCosto = Utils.round(filteredProducts.reduce((acc, p) => acc + (p.costoUSD * p.stock), 0));
  const totalVenta = Utils.round(filteredProducts.reduce((acc, p) => acc + (p.precioUSD * p.stock), 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end bg-white p-5 rounded-xl border border-line shadow-sm no-print">
        <div className="form-group mb-0">
          <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Filtrar por Departamento</label>
          <div className="relative">
            <LayoutGrid className="absolute left-3 top-2.5 w-4 h-4 text-brand-gold opacity-50" />
            <select 
              className="form-select pl-10 h-10 bg-surface-soft border-line text-ink font-bold text-sm rounded-lg"
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
            >
              <option value="">TODOS LOS DEPARTAMENTOS</option>
              {(state.departamentos || []).map(d => (
                <option key={`dept-report-${d}-${Math.random()}`} value={d}>{d?.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="kpi p-6 border-line shadow-md bg-white rounded-2xl">
          <div className="text-[10px] font-black uppercase mb-1 text-ink opacity-60">Valor al Costo (CPP Total)</div>
          <div className="text-3xl font-black text-ink">{Utils.fmtUSD(totalCosto)}</div>
        </div>
        <div className="kpi p-6 border-line shadow-md bg-white rounded-2xl">
          <div className="text-[10px] font-black uppercase mb-1 text-ink opacity-60">Valor al Precio de Venta (Total)</div>
          <div className="text-3xl font-black text-status-success">{Utils.fmtUSD(totalVenta)}</div>
        </div>
      </div>
      
      <Card className="shadow-lg border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <Boxes className="w-5 h-5 text-brand-gold" /> INVENTARIO VALORIZADO ACTUAL
          </h3>
          <button className="btn btn-secondary h-8 px-4 font-black uppercase text-[9px]" onClick={() => exportarPDFInventarioGeneral(filteredProducts, state.empresa, 'categoria', { costo: totalCosto, venta: totalVenta })}>
            PDF Profesional
          </button>
        </div>
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-soft">
                <TableHead className="font-black text-ink uppercase text-[10px]">Cod.</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Producto</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Costo Unit.</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Venta Unit.</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-center">Stock</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Subtotal Costo</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-20 text-ink/20 font-black italic uppercase">No se encontraron productos para el departamento seleccionado</TableCell></TableRow>
              ) : (
                filteredProducts.map(p => (
                  <TableRow key={p.id} className="border-b border-line/30">
                    <TableCell className="mono text-[11px] font-black text-ink">{p.codigo}</TableCell>
                    <TableCell className="font-black uppercase text-xs text-ink">{p.nombre}</TableCell>
                    <TableCell className="mono text-right text-xs font-bold text-ink/60">{Utils.fmtUSD(p.costoUSD)}</TableCell>
                    <TableCell className="mono text-right text-brand-gold-deep font-black">{Utils.fmtUSD(p.precioUSD)}</TableCell>
                    <TableCell className="text-center py-3 px-4"><span className="badge badge-neutral font-black">{p.stock}</span></TableCell>
                    <TableCell className="mono text-right font-black text-ink">{Utils.fmtUSD(Utils.round(p.costoUSD * p.stock))}</TableCell>
                    <TableCell>
                      <div className="flex justify-center gap-1">
                        <button className="btn-icon h-8 w-8 text-ink hover:text-brand-gold" title="Editar" onClick={() => onAction('edit', p.id)}><Edit2 className="w-4 h-4" /></button>
                        <button className="btn-icon h-8 w-8 text-ink hover:text-status-info" title="Kardex" onClick={() => onAction('kardex', p.id)}><History className="w-4 h-4" /></button>
                        <button className="btn-icon h-8 w-8 text-ink hover:text-status-success" title="Ajustes" onClick={() => onAction('adjust', p.id)}><Boxes className="w-4 h-4" /></button>
                        <button className="btn-icon h-8 w-8 text-blue-600 hover:bg-blue-50" title="Detalle CPP" onClick={() => onAction('cpp', p.id)}><Calculator className="w-4 h-4" /></button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ModalCPP({ producto, movimientos, onClose }: { producto: Product, movimientos: Movimiento[], onClose: () => void }) {
  const compras = movimientos
    .filter(m => m.tipo === 'compra' || m.tipo === 'ajuste_entrada')
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 10);

  const format4 = (v: number) => 'USD $' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  return (
    <div className="modal show"><div className="modal-bg" onClick={onClose}></div>
      <div className="modal-box bg-white max-w-sm border-none rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="modal-head py-3 px-5 border-none bg-black flex justify-between items-center rounded-t-xl">
          <div className="flex items-center gap-2 text-white">
            <Calculator className="w-4 h-4" />
            <h3 className="font-bold text-xs uppercase tracking-wider">Detalle de Costo - CPP</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="text-center">
            <h4 className="font-bold text-base text-gray-900 leading-tight mb-0.5">{producto.nombre}</h4>
            <p className="text-[9px] font-black text-gray-400 tracking-widest">{producto.codigo}</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
            <span className="text-[10px] font-bold text-gray-500 uppercase">COSTO ACTUAL (PONDERADO)</span>
            <span className="text-[#2563EB] font-mono font-black text-lg">{format4(producto.costoUSD)}</span>
          </div>

          <div className="space-y-3">
            <h5 className="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1.5">HISTORIAL DE COSTOS (ÚLTIMAS COMPRAS)</h5>
            <div className="max-h-[220px] overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {compras.length === 0 ? (
                <div className="py-8 text-center text-gray-300 font-bold uppercase italic text-[10px]">Sin historial de compras registrado</div>
              ) : (
                compras.map((m, idx) => {
                  return (
                    <div key={m.id} className="space-y-1.5">
                      <div className="flex justify-between items-baseline text-[10px] font-bold text-gray-600">
                        <span>{Utils.fmtFecha(m.fecha)}</span>
                        <span className="font-mono">{format4(producto.costoUSD)}</span>
                        <span className="text-gray-400">x{Math.abs(m.cantidad)} uds</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center space-y-0.5">
            <p className="text-[7px] font-bold text-amber-700 uppercase">El costo actual se calcula mediante Promedio Ponderado (CPP)</p>
            <p className="text-[7px] font-medium text-amber-600 italic">Fórmula: ((Stock Ant × Costo Ant) + (Cantidad Nueva × Costo Nuevo)) / Stock Total</p>
          </div>
        </div>

        <div className="p-2.5 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-[10px] font-black uppercase text-gray-500 hover:text-gray-900 transition-colors">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ReporteVentas({ state }: { state: AppState }) {
  const [desde, setDesde] = useState(Utils.hoy());
  const [hasta, setHasta] = useState(Utils.hoy());
  const [useDates, setUseDates] = useState(false);
  const [terminalId, setTerminalId] = useState('all');

  const filteredVentas = useMemo(() => {
    return (state.ventas || []).filter(v => {
      const d = v.fecha.slice(0, 10);
      const dateMatch = !useDates ? d === Utils.hoy() : (d >= desde && d <= hasta);
      const terminalMatch = terminalId === 'all' || v.terminalId === terminalId;
      return dateMatch && terminalMatch;
    });
  }, [state.ventas, desde, hasta, useDates, terminalId]);

  const groupedVentas = useMemo(() => {
    const groups = new Map<string, { 
      id: string, 
      nombre: string, 
      cantidad: number, 
      totalUSD: number 
    }>();
    
    filteredVentas.forEach(v => {
      v.items.forEach(item => {
        const productId = item.productoId || `temp-${item.nombre.trim()}`;
        const normalizedName = item.nombre.toUpperCase().trim();
        const key = `${productId}-${normalizedName}`;
        
        if (!groups.has(key)) {
          groups.set(key, {
            id: productId,
            nombre: item.nombre.trim(),
            cantidad: 0,
            totalUSD: 0
          });
        }
        const group = groups.get(key)!;
        group.cantidad += item.cantidad;
        group.totalUSD += item.subtotalUSD;
      });
    });
    
    return Array.from(groups.values()).sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredVentas]);

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-white border-line flex flex-wrap gap-4 items-end shadow-sm no-print">
        <div className="flex items-center gap-3 bg-surface-soft p-1 rounded-lg border border-line">
           <button onClick={() => setUseDates(false)} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${!useDates ? 'bg-ink text-white' : 'text-ink/40'}`}>Hoy</button>
           <button onClick={() => setUseDates(true)} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${useDates ? 'bg-brand-gold text-white' : 'text-ink/40'}`}>Periodo</button>
        </div>
        {useDates && (
           <div className="flex items-center gap-2">
              <input type="date" className="form-input h-8 text-xs font-bold" value={desde} onChange={e => setDesde(e.target.value)} />
              <input type="date" className="form-input h-8 text-xs font-bold" value={hasta} onChange={e => setHasta(e.target.value)} />
           </div>
        )}
        <div className="form-group mb-0">
          <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Punto de Venta / Terminal</label>
          <div className="relative">
            <Monitor className="absolute left-3 top-2.5 w-3.5 h-3.5 text-brand-gold opacity-50" />
            <select 
              className="form-select pl-9 h-8 text-[10px] font-black uppercase bg-surface-soft border-line rounded-md"
              value={terminalId}
              onChange={e => setTerminalId(e.target.value)}
            >
              <option value="all">TODOS LOS TERMINALES (GLOBAL)</option>
              {state.terminales.map(t => (
                <option value={t.id} key={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card className="bg-white shadow-lg border-line rounded-xl overflow-hidden">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 text-white">
           <h3 className="font-black text-xs uppercase italic tracking-tighter">
             RESUMEN DE VENTAS {terminalId === 'all' ? 'GENERAL' : `TERMINAL: ${state.terminales.find(t => t.id === terminalId)?.nombre || terminalId}`}
           </h3>
        </div>
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-soft">
                <TableHead className="font-black text-ink uppercase text-[10px]">Producto / Ítem</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-center">Unidades Vendidas</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Recaudado (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedVentas.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-20 text-ink/20 font-black italic uppercase">Sin ventas registradas para la selección actual</TableCell></TableRow>
              ) : (
                groupedVentas.map((g) => (
                  <TableRow 
                    key={`${g.id}-${g.nombre.replace(/\s+/g, '-')}`} 
                    className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors"
                  >
                    <TableCell className="font-black uppercase text-xs text-ink">{g.nombre}</TableCell>
                    <TableCell className="text-center font-black mono text-ink">{g.cantidad}</TableCell>
                    <TableCell className="text-right font-black text-brand-gold-deep mono">{Utils.fmtUSD(g.totalUSD)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ReporteDevoluciones({ state }: { state: AppState }) {
  const [selectedDevolucion, setSelectedDevolucion] = useState<Return | null>(null);
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });
  const devoluciones = (state.devoluciones || []).filter(d =>
    d.fecha && d.fecha.slice(0, 10) >= rango.desde && d.fecha.slice(0, 10) <= rango.hasta
  );
  const totalUSD = devoluciones.reduce((acc, d) => acc + d.totalUSD, 0);

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-white border-line shadow-sm rounded-xl no-print">
        <label className="text-[10px] font-black uppercase text-ink/40 block mb-2">CONSULTAR DEVOLUCIONES POR PERÍODO</label>
        <DateRangeFilter value={rango} onChange={setRango} />
      </Card>
      <Card className="shadow-lg border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center text-white">
          <h3 className="font-black text-xs uppercase italic tracking-tighter">HISTORIAL DE DEVOLUCIONES</h3>
          <button className="btn btn-secondary h-8 px-4 font-black text-[9px]" onClick={() => exportarPDFDevoluciones(devoluciones, state.empresa, 'Histórico', { totalUSD })}>PDF</button>
        </div>
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-soft">
                <TableHead className="text-[10px] font-black uppercase text-left">Fecha</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-left">Venta Ref.</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-right">Total Dev.</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-left">Motivo</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-center">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {devoluciones.map(d => (
                 <TableRow key={d.id} className="border-b border-line/30">
                   <TableCell className="text-xs font-bold text-ink">{Utils.fmtFecha(d.fecha)}</TableCell>
                   <TableCell className="text-xs font-black mono text-ink">{d.ventaId}</TableCell>
                   <TableCell className="text-right font-black text-status-danger">{Utils.fmtUSD(d.totalUSD)}</TableCell>
                   <TableCell className="text-xs italic uppercase opacity-60 text-ink truncate max-w-[200px]">{d.motivo}</TableCell>
                   <TableCell className="text-center">
                      <button onClick={() => setSelectedDevolucion(d)} className="btn-icon h-8 w-8 text-ink hover:text-brand-gold">
                        <Eye className="w-4 h-4" />
                      </button>
                   </TableCell>
                 </TableRow>
               ))}
               {devoluciones.length === 0 && (
                 <TableRow><TableCell colSpan={5} className="text-center py-20 text-ink/20 font-black italic uppercase">No se registran devoluciones</TableCell></TableRow>
               )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {selectedDevolucion && (
        <div className="modal show"><div className="modal-bg" onClick={() => setSelectedDevolucion(null)}></div>
          <div className="modal-box bg-white max-w-lg border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black uppercase italic tracking-tighter text-sm">DETALLE DE DEVOLUCIÓN: {selectedDevolucion.id}</h3>
              <button onClick={() => setSelectedDevolucion(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Venta Referencia</label>
                  <p className="text-xs font-black text-ink">{selectedDevolucion.ventaId}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-lg border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Método Reembolso</label>
                  <p className="text-xs font-black text-ink uppercase">{selectedDevolucion.metodoReembolso}</p>
                </div>
              </div>
              <div className="table-wrap border border-line rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-surface-soft">
                    <tr>
                      <th className="text-[9px] font-black uppercase p-2 text-left">Producto</th>
                      <th className="text-[9px] font-black uppercase p-2 text-center">Cant</th>
                      <th className="text-[9px] font-black uppercase p-2 text-right">Precio</th>
                      <th className="text-[9px] font-black uppercase p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDevolucion.items.map((it, idx) => (
                      <tr key={`${idx}-${it.productoId || it.nombre}`} className="border-b border-line/20">
                        <td className="text-[10px] font-bold p-2 uppercase">{it.nombre}</td>
                        <td className="text-[10px] font-black p-2 text-center">{it.cantidad}</td>
                        <td className="text-[10px] font-bold p-2 text-right">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                        <td className="text-[10px] font-black p-2 text-right text-status-danger">{Utils.fmtUSD(it.cantidad * it.precioUnitUSD)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-brand-gold-soft/20 border border-brand-gold/10 rounded-lg">
                <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Motivo de Devolución</label>
                <p className="text-xs italic text-ink uppercase">{selectedDevolucion.motivo}</p>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-black uppercase text-ink/40">Total Reembolsado:</span>
                <span className="text-xl font-black text-status-danger">{Utils.fmtUSD(selectedDevolucion.totalUSD)}</span>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
              <button onClick={() => setSelectedDevolucion(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistorialAjustes({ state }: { state: AppState }) {
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });
  const ajustes = (state.movimientos || []).filter(m => 
    ['ajuste_entrada', 'ajuste_salida', 'consumo', 'colaboracion'].includes(m.tipo)
  ).filter(m => m.fecha && m.fecha.slice(0, 10) >= rango.desde && m.fecha.slice(0, 10) <= rango.hasta)
  .sort((a,b) => b.fecha.localeCompare(a.fecha));

  const totalVariacionUSD = ajustes.reduce((acc, m) => {
    const p = state.productos.find(prod => prod.id === m.productoId);
    const costo = p?.costoUSD || 0;
    return acc + (m.cantidad * costo);
  }, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`kpi p-6 rounded-2xl shadow-sm border-l-[6px] flex items-center gap-4 ${totalVariacionUSD < 0 ? 'bg-status-danger-soft border-l-status-danger' : 'bg-status-success-soft border-l-status-success'}`}>
          <div className={`p-3 rounded-xl ${totalVariacionUSD < 0 ? 'bg-status-danger text-white' : 'bg-status-success text-white'}`}>
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-ink/40">Efecto Neto en Inventario (USD)</p>
            <p className={`text-2xl font-black ${totalVariacionUSD < 0 ? 'text-status-danger' : 'text-status-success'}`}>
              {totalVariacionUSD < 0 ? '-' : '+'}{Utils.fmtUSD(Math.abs(totalVariacionUSD))}
            </p>
          </div>
        </div>
      </div>

      <Card className="p-5 bg-white border-line shadow-sm rounded-xl no-print">
        <label className="text-[10px] font-black uppercase text-ink/40 block mb-2">CONSULTAR AJUSTES POR PERÍODO</label>
        <DateRangeFilter value={rango} onChange={setRango} />
      </Card>

      <Card className="shadow-lg border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <History className="w-5 h-5 text-brand-gold" /> BITÁCORA GENERAL DE AJUSTES Y VARIACIONES
          </h3>
        </div>
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-soft">
                <TableHead className="font-black text-ink uppercase text-[10px]">Fecha</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Producto</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Operación</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-center">Cant</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Costo Unit.</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Motivo / Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ajustes.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-24 text-center text-ink/20 font-black italic uppercase">No existen ajustes o consumos registrados</TableCell></TableRow>
              ) : (
                ajustes.map(m => {
                  const p = state.productos.find(prod => prod.id === m.productoId);
                  return (
                    <TableRow key={m.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                      <TableCell className="text-xs font-bold text-ink">
                        {m.fecha.slice(0,16).replace('T', ' ')}
                      </TableCell>
                      <TableCell>
                        <div className="font-black uppercase text-xs text-ink">{p?.nombre || 'ELIMINADO'}</div>
                        <div className="text-[9px] opacity-40 mono">{p?.codigo || '-'}</div>
                      </TableCell>
                      <TableCell>
                        <span className={`badge ${['consumo', 'colaboracion'].includes(m.tipo) ? 'bg-amber-100 text-amber-700' : 'badge-neutral'} text-[9px] font-black uppercase`}>
                          {m.tipo.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell className={`text-center font-black ${m.cantidad > 0 ? 'text-status-success' : 'text-status-danger'}`}>
                        {m.cantidad > 0 ? '+' : ''}{m.cantidad}
                      </TableCell>
                      <TableCell className="text-right mono text-xs font-bold text-ink/40">
                        {Utils.fmtUSD(p?.costoUSD || 0)}
                      </TableCell>
                      <TableCell>
                        <div className="text-[10px] opacity-60 italic uppercase text-ink max-w-[250px] truncate" title={m.referencia}>
                          {m.referencia}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ReporteConsumo({ state }: { state: AppState }) {
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });
  const consumos = (state.movimientos || [])
    .filter(m => ['consumo', 'colaboracion'].includes(m.tipo))
    .filter(m => m.fecha && m.fecha.slice(0, 10) >= rango.desde && m.fecha.slice(0, 10) <= rango.hasta)
    .sort((a,b) => b.fecha.localeCompare(a.fecha));

  const totalPerdida = consumos.reduce((acc, m) => {
    const p = state.productos.find(prod => prod.id === m.productoId);
    return acc + (Math.abs(m.cantidad) * (p?.costoUSD || 0));
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="kpi bg-status-danger-soft border-status-danger/20 p-6 rounded-2xl shadow-sm border-l-[6px] border-l-status-danger flex items-center gap-4">
          <div className="p-3 bg-status-danger text-white rounded-xl"><AlertCircle className="w-6 h-6" /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-status-danger/70">Total Pérdida por Consumo</p>
            <p className="text-2xl font-black text-status-danger">{Utils.fmtUSD(totalPerdida)}</p>
          </div>
        </div>
      </div>

      <Card className="p-5 bg-white border-line shadow-sm rounded-xl no-print">
        <label className="text-[10px] font-black uppercase text-ink/40 block mb-2">CONSULTAR CONSUMO Y COLABORACIONES POR PERÍODO</label>
        <DateRangeFilter value={rango} onChange={setRango} />
      </Card>

      <Card className="shadow-lg border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 text-white">
           <h3 className="font-black text-xs uppercase italic tracking-tighter">HISTORIAL DE CONSUMO Y COLABORACIONES</h3>
        </div>
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-soft">
                <TableHead className="font-black text-ink uppercase text-[10px]">Fecha</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Producto</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Tipo</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">P. Costo</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-center">Cant</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px] text-right">Total Costo</TableHead>
                <TableHead className="font-black text-ink uppercase text-[10px]">Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="bg-white">
              {consumos.map(m => {
                const p = state.productos.find(prod => prod.id === m.productoId);
                const costo = p?.costoUSD || 0;
                const subtotal = Math.abs(m.cantidad) * costo;
                
                return (
                  <TableRow key={m.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                    <TableCell className="text-xs font-bold text-ink">{m.fecha.slice(0,10)}</TableCell>
                    <TableCell className="font-black uppercase text-xs text-ink">{p?.nombre || 'Producto Eliminado'}</TableCell>
                    <TableCell><span className="badge badge-neutral font-black text-[9px] uppercase">{m.tipo.replace('_', ' ')}</span></TableCell>
                    <TableCell className="text-right mono text-xs text-ink/50">{Utils.fmtUSD(costo)}</TableCell>
                    <TableCell className={`text-center font-black text-status-danger`}>{Math.abs(m.cantidad)}</TableCell>
                    <TableCell className="text-right mono font-black text-status-danger">{Utils.fmtUSD(subtotal)}</TableCell>
                    <TableCell className="text-[10px] uppercase font-bold opacity-40 text-ink max-w-[250px] truncate">{m.referencia}</TableCell>
                  </TableRow>
                );
              })}
              {consumos.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-20 text-center text-ink/20 font-black italic uppercase">No se registran consumos o colaboraciones</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ReporteKardex({ state, selectedId, onSelect }: { state: AppState, selectedId: string | null, onSelect: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [rango, setRango] = useState<DateRange>({ desde: Utils.hoy(), hasta: Utils.hoy() });
  const selectedProd = selectedId ? state.productos.find(p => p.id === selectedId) : null;
  
  const movs = useMemo(() => {
    if (!selectedId || !state.movimientos) return [];
    return state.movimientos
      .filter(m => m.productoId === selectedId)
      .filter(m => m.fecha && m.fecha.slice(0, 10) >= rango.desde && m.fecha.slice(0, 10) <= rango.hasta)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [selectedId, state.movimientos, rango]);

  const matches = useMemo(() => {
    if (search.trim().length < 2) return [];
    return state.productos.filter(p => 
      p.activo && 
      ((p.nombre || '').toLowerCase().includes(search.toLowerCase()) || (p.codigo || '').includes(search))
    ).slice(0, 5);
  }, [search, state.productos]);

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-white border-line shadow-sm rounded-xl">
        <label className="text-[10px] font-black uppercase text-ink opacity-40 block mb-2">Buscar producto para ver Kardex Fiscal</label>
        <div className="relative">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Escriba nombre o código..." className="h-12 text-sm font-bold bg-white" />
          {matches.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white border border-line shadow-2xl z-50 mt-1 rounded-xl overflow-hidden">
              {matches.map(p => (
                <div key={p.id} className="p-4 border-b border-line hover:bg-brand-gold-soft cursor-pointer transition-all flex justify-between items-center" onClick={() => { onSelect(p.id); setSearch(''); }}>
                  <div><p className="font-black uppercase text-xs text-ink">{p.nombre}</p><p className="text-[10px] opacity-40 text-ink">{p.codigo}</p></div>
                  <Check className="w-4 h-4 text-brand-gold" />
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {selectedProd && (
        <Card className="overflow-hidden shadow-lg border-line rounded-xl bg-white">
          <div className="card-head bg-ink text-white px-6 py-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
               <ShieldAlert className="w-5 h-5 text-brand-gold" />
               <h3 className="font-black text-xs uppercase tracking-widest text-brand-gold">{selectedProd.nombre}</h3>
            </div>
            <button className="btn btn-secondary h-8 px-4 font-black uppercase text-[9px]" onClick={() => exportarPDFKardex(selectedProd, movs, state.empresa, state.terminales)}>Exportar Kardex</button>
          </div>
          <div className="px-6 py-3 bg-white border-b border-line no-print">
            <DateRangeFilter value={rango} onChange={setRango} />
          </div>
          <div className="table-wrap">
             <Table>
                <TableHeader className="bg-surface-soft">
                   <TableRow>
                      <TableHead className="font-black text-ink uppercase text-[10px]">Fecha y Hora</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px]">Tipo</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px] text-center">Cant</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px] text-center">Stock Antes</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px] text-center">Nuevo Stock</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px]">Terminal</TableHead>
                      <TableHead className="font-black text-ink uppercase text-[10px]">Referencia</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                   {movs.map(m => (
                      <TableRow key={m.id} className="border-b border-line/30">
                         <TableCell className="text-xs font-bold text-ink">
                            {m.fecha.replace('T', ' ').slice(0, 19)}
                         </TableCell>
                         <TableCell><span className="badge badge-neutral text-[9px] uppercase font-black">{m.tipo.replace('_', ' ')}</span></TableCell>
                         <TableCell className={`text-center font-black ${m.cantidad > 0 ? 'text-status-success' : 'text-status-danger'}`}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</TableCell>
                         <TableCell className="text-center font-bold text-ink/40">{m.stockAntes}</TableCell>
                         <TableCell className="text-center font-black text-ink">{m.stockDespues}</TableCell>
                         <TableCell className="text-[10px] font-black uppercase text-ink/60">
                            {state.terminales.find(t => t.id === m.terminalId)?.nombre || m.terminalId || 'ADMIN'}
                         </TableCell>
                         <TableCell className="text-[9px] italic opacity-40 uppercase text-ink truncate max-w-[200px]" title={m.referencia}>
                            {m.referencia}
                         </TableCell>
                      </TableRow>
                   ))}
                   {movs.length === 0 && (
                     <TableRow><TableCell colSpan={7} className="py-20 text-center text-ink/20 font-black uppercase italic">Sin movimientos registrados para este ítem</TableCell></TableRow>
                   )}
                </TableBody>
             </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ModalAjuste({ producto, onClose, onSave }: { producto: Product, onClose: () => void, onSave: (m: Movimiento, nuevoCosto?: number) => void }) {
  const [tipo, setTipo] = useState<'ajuste_entrada' | 'ajuste_salida' | 'consumo' | 'colaboracion'>('ajuste_entrada');
  const [cantidad, setCantidad] = useState<string>('1');
  const [nuevoCosto, setNuevoCosto] = useState<string>(String(producto.costoUSD));
  const [motivo, setMotivo] = useState('');

  const handleSave = () => {
    const pCant = parseFloat(cantidad) || 0;
    const pCosto = parseFloat(nuevoCosto) || 0;
    if (pCant <= 0) return alert('Cantidad invalida');
    if (!motivo.trim()) return alert('Por favor indique el motivo del ajuste');

    const mov: Movimiento = {
      id: Store.uid(),
      productoId: producto.id,
      tipo,
      cantidad: (tipo === 'ajuste_entrada') ? pCant : -Math.abs(pCant),
      stockAntes: producto.stock,
      stockDespues: (tipo === 'ajuste_entrada') ? producto.stock + pCant : producto.stock - Math.abs(pCant),
      fecha: Utils.ahora(),
      referencia: motivo.toUpperCase(),
      terminalId: 'ADMIN'
    };
    onSave(mov, tipo === 'ajuste_entrada' ? pCosto : undefined);
  };

  return (
    <div className="modal show"><div className="modal-bg" onClick={() => onClose()}></div>
      <div className="modal-box bg-white max-w-md border-2 border-line rounded-xl overflow-hidden shadow-2xl">
        <div className="modal-head px-5 py-4 border-b border-line bg-surface-soft">
          <h3 className="text-ink font-black uppercase text-sm">AJUSTAR: {producto.nombre.toUpperCase()}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-ink" /></button>
        </div>
        <div className="modal-body p-6 space-y-4 bg-white">
          <div className="grid grid-cols-2 gap-4">
             <div className="form-group"><Label className="text-[10px] font-black uppercase text-ink/60 mb-1 block">Tipo</Label>
               <select className="form-select h-10 text-xs font-bold" value={tipo} onChange={e => setTipo(e.target.value as any)}>
                 <option value="ajuste_entrada">Entrada (+)</option>
                 <option value="ajuste_salida">Salida (-)</option>
                 <option value="consumo">Consumo Propio</option>
                 <option value="colaboracion">Colaboración</option>
               </select>
             </div>
             <div className="form-group"><Label className="text-[10px] font-black uppercase text-ink/60 mb-1 block">Cantidad</Label>
               <Input className="h-10 text-center font-black bg-white" type="text" value={cantidad} onChange={e => setCantidad(e.target.value)} />
             </div>
          </div>
          <div className="form-group">
            <Label className="text-[10px] font-black uppercase text-ink/60 mb-1 block">Motivo del Ajuste</Label>
            <Input 
              className="h-10 text-xs font-black uppercase bg-white" 
              placeholder="Ej: ERROR DE CONTEO, DAÑO, ETC..." 
              value={motivo} 
              onChange={e => setMotivo(e.target.value)} 
            />
          </div>
          <Button className="w-full h-12 font-black uppercase text-xs shadow-md mt-2" onClick={handleSave}>Procesar Ajuste</Button>
        </div>
      </div>
    </div>
  );
}