"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Product, KitItem } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { X, Box, PlusCircle, MinusCircle, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

interface ProductFormModalProps {
  producto?: Product;
  state: AppState;
  onClose: () => void;
  onSave: (p: any) => void;
  onUpdateLists: (l: any) => void;
}

export function ProductFormModal({ producto, state, onClose, onSave, onUpdateLists }: ProductFormModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'precios' | 'kit'>('general');
  const [datos, setDatos] = useState<any>({
    codigo: producto?.codigo || '',
    nombre: producto?.nombre || '',
    categoria: producto?.categoria || state.categorias[0] || '',
    departamento: producto?.departamento || state.departamentos[0] || '',
    marca: producto?.marca || state.marcas[0] || '',
    costoUSD: producto?.costoUSD?.toString() ?? '0',
    margen: producto?.margen?.toString() ?? '0',
    precioUSD: producto?.precioUSD?.toString() ?? '0',
    precioBS: producto ? (producto.precioUSD * state.tasa).toFixed(2) : '0',
    precioMayorUSD: producto?.precioMayorUSD?.toString() ?? '0',
    precioOfertaUSD: producto?.precioOfertaUSD?.toString() ?? '0',
    precioPromoUSD: producto?.precioPromoUSD?.toString() ?? '0',
    stock: producto?.stock?.toString() ?? '0',
    stockMinimo: producto?.stockMinimo?.toString() ?? '3',
    aplicaIVA: producto?.aplicaIVA ?? false,
    isKit: producto?.isKit || false,
    kitType: producto?.kitType || 'stock_propio',
    kitItems: producto?.kitItems || [],
    proveedor: producto?.proveedor || '',
    cantidad: producto?.cantidad || 'Unidad'
  });

  const [kitSearch, setKitSearch] = useState('');
  
  const filteredProdsForKit = useMemo(() => {
    if (kitSearch.length < 2) return [];
    return state.productos.filter(p => 
      p.activo && 
      !p.isKit && 
      (p.nombre.toLowerCase().includes(kitSearch.toLowerCase()) || p.codigo.toLowerCase().includes(kitSearch.toLowerCase()))
    ).slice(0, 5);
  }, [kitSearch, state.productos]);

  const validarDecimal = (val: string) => /^[\d]*\.?[\d]*$/.test(val) || val === '';

  const recalcularTridireccional = (field: 'margen' | 'precioUSD' | 'precioBS', value: string) => {
    if (!validarDecimal(value)) return;
    const cost = parseFloat(datos.costoUSD) || 0;
    const val = parseFloat(value) || 0;
    const tasa = state.tasa;

    let newMargen = parseFloat(datos.margen) || 0;
    let newUSD = parseFloat(datos.precioUSD) || 0;
    let newBS = parseFloat(datos.precioBS) || 0;

    if (field === 'margen') {
      newMargen = val;
      if (newMargen < 100) {
        newUSD = cost / (1 - (newMargen / 100));
        newBS = newUSD * tasa;
      }
    } else if (field === 'precioUSD') {
      newUSD = val;
      if (newUSD > 0) {
        newMargen = ((newUSD - cost) / newUSD) * 100;
        newBS = newUSD * tasa;
      }
    } else if (field === 'precioBS') {
      newBS = val;
      if (newBS > 0) {
        newUSD = newBS / tasa;
        newMargen = ((newUSD - cost) / newUSD) * 100;
      }
    }

    setDatos({
      ...datos,
      [field]: value,
      margen: field === 'margen' ? value : newMargen.toFixed(2),
      precioUSD: field === 'precioUSD' ? value : newUSD.toFixed(2),
      precioBS: field === 'precioBS' ? value : newBS.toFixed(2)
    });
  };

  const handleAddListItem = (listName: 'categorias' | 'marcas' | 'departamentos' | 'presentaciones') => {
    const newVal = prompt(`Ingrese nueva opción para ${listName.toUpperCase()}:`);
    if (newVal) {
      onUpdateLists({ [listName]: [...(state[listName] || []), newVal] });
    }
  };

  const handleRemoveListItem = (listName: 'categorias' | 'marcas' | 'departamentos' | 'presentaciones', current: string) => {
    if (confirm(`¿Eliminar "${current}" de la lista?`)) {
      const newList = (state[listName] || []).filter(i => i !== current);
      onUpdateLists({ [listName]: newList });
    }
  };

  const handleSave = () => {
    if (!datos.nombre || !datos.codigo) return alert('Nombre y Código requeridos');
    
    const existe = state.productos.find(p => p.activo && p.codigo === datos.codigo && p.id !== producto?.id);
    if (existe) {
      alert(`ERROR: El código "${datos.codigo}" ya se encuentra registrado para el producto "${existe.nombre}". No se permiten duplicados.`);
      return;
    }

    onSave({
      ...datos,
      costoUSD: parseFloat(datos.costoUSD) || 0,
      margen: parseFloat(datos.margen) || 0,
      precioUSD: parseFloat(datos.precioUSD) || 0,
      stock: parseFloat(datos.stock) || 0,
      stockMinimo: parseFloat(datos.stockMinimo) || 0
    });
  };

  return (
    <div className="modal show"><div className="modal-bg" onClick={() => onClose()}></div>
      <div className="modal-box bg-white max-w-2xl border-2 border-line rounded-xl overflow-hidden shadow-2xl">
        <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
          <h3 className="font-black uppercase italic tracking-tighter text-sm flex items-center gap-2">
            <Box className="w-5 h-5 text-brand-gold" /> {producto ? 'EDITAR FICHA' : 'NUEVO ÍTEM / PRODUCTO'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-5 h-5"/></button>
        </div>

        <div className="flex bg-surface-soft border-b border-line">
          <button onClick={() => setActiveTab('general')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'general' ? 'border-brand-gold text-brand-gold bg-white' : 'border-transparent text-ink/40'}`}>General</button>
          <button onClick={() => setActiveTab('precios')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'precios' ? 'border-brand-gold text-brand-gold bg-white' : 'border-transparent text-ink/40'}`}>Precios</button>
          <button onClick={() => setActiveTab('kit')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'kit' ? 'border-brand-gold text-brand-gold bg-white' : 'border-transparent text-ink/40'}`}>Kits / Combos</button>
        </div>

        <div className="modal-body p-6 space-y-6 bg-white max-h-[70vh] overflow-y-auto">
          {activeTab === 'general' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase text-ink/50 block">Código (Scanner/Manual)</Label>
                  <Input className="h-10 font-black text-ink bg-white" value={datos.codigo} onChange={e => setDatos({...datos, codigo: e.target.value})} placeholder="00000000" autoFocus />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase text-ink/50 block">Nombre del Producto</Label>
                  <Input className="h-10 font-black text-ink uppercase bg-white" value={datos.nombre} onChange={e => setDatos({...datos, nombre: e.target.value})} />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="space-y-1">
                     <div className="flex justify-between items-center mb-1">
                       <Label className="text-[10px] font-black uppercase text-ink/50">Departamento</Label>
                       <div className="flex gap-1">
                         <button onClick={() => handleAddListItem('departamentos')} className="text-brand-gold"><PlusCircle className="w-3.5 h-3.5"/></button>
                         <button onClick={() => handleRemoveListItem('departamentos', datos.departamento)} className="text-status-danger"><MinusCircle className="w-3.5 h-3.5"/></button>
                       </div>
                     </div>
                     <select className="form-select h-10 text-xs font-bold bg-white" value={datos.departamento} onChange={e => setDatos({...datos, departamento: e.target.value})}>
                       {(state.departamentos || []).map((d: string) => <option key={d} value={d}>{d}</option>)}
                     </select>
                   </div>

                   <div className="space-y-1">
                     <div className="flex justify-between items-center mb-1">
                       <Label className="text-[10px] font-black uppercase text-ink/50">Categoría</Label>
                       <div className="flex gap-1">
                         <button onClick={() => handleAddListItem('categorias')} className="text-brand-gold"><PlusCircle className="w-3.5 h-3.5"/></button>
                         <button onClick={() => handleRemoveListItem('categorias', datos.categoria)} className="text-status-danger"><MinusCircle className="w-3.5 h-3.5"/></button>
                       </div>
                     </div>
                     <select className="form-select h-10 text-xs font-bold bg-white" value={datos.categoria} onChange={e => setDatos({...datos, categoria: e.target.value})}>
                       {(state.categorias || []).map((cat: string) => <option key={cat} value={cat}>{cat}</option>)}
                     </select>
                   </div>

                   <div className="space-y-1 col-span-2">
                     <div className="flex justify-between items-center mb-1">
                       <Label className="text-[10px] font-black uppercase text-ink/50">U. de Medida</Label>
                       <div className="flex gap-1">
                         <button onClick={() => handleAddListItem('presentaciones')} className="text-brand-gold"><PlusCircle className="w-3.5 h-3.5"/></button>
                         <button onClick={() => handleRemoveListItem('presentaciones', datos.cantidad)} className="text-status-danger"><MinusCircle className="w-3.5 h-3.5"/></button>
                       </div>
                     </div>
                     <select className="form-select h-10 text-xs font-bold bg-white" value={datos.cantidad} onChange={e => setDatos({...datos, cantidad: e.target.value})}>
                       {(state.presentaciones || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
                     </select>
                   </div>
                </div>
              </div>
              <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                   <div className={`p-3 bg-surface-soft border border-line rounded-xl text-center ${producto ? 'opacity-50' : ''}`}>
                     <Label className="text-[9px] font-black uppercase text-ink/50 block mb-1">Stock Inicial</Label>
                     <Input 
                        className="bg-transparent border-none text-center font-black text-xl w-full focus:outline-none" 
                        disabled={!!producto}
                        value={datos.stock} 
                        onChange={e => setDatos({...datos, stock: e.target.value})} 
                      />
                   </div>
                   <div className="p-3 bg-status-danger-soft border border-status-danger/20 rounded-xl text-center">
                     <Label className="text-[9px] font-black uppercase text-status-danger/70 block mb-1">Mínimo</Label>
                     <Input className="bg-transparent border-none text-center font-black text-xl w-full text-status-danger focus:outline-none" value={datos.stockMinimo} onChange={e => setDatos({...datos, stockMinimo: e.target.value})} />
                   </div>
                 </div>
                 <div className="flex items-center gap-3 p-4 bg-surface-soft rounded-xl border border-line">
                   <button onClick={() => setDatos({...datos, aplicaIVA: !datos.aplicaIVA})} className={`w-12 h-6 rounded-full transition-all relative ${datos.aplicaIVA ? 'bg-status-success' : 'bg-ink/20'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${datos.aplicaIVA ? 'right-1' : 'left-1'}`} /></button>
                   <Label className="text-[10px] font-black uppercase text-ink cursor-pointer" onClick={() => setDatos({...datos, aplicaIVA: !datos.aplicaIVA})}>Aplica IVA (16%)</Label>
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'precios' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-surface-soft p-5 rounded-2xl border border-line shadow-inner">
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase text-ink/50">Costo ($)</Label><Input className="h-12 font-black text-lg bg-white" value={datos.costoUSD} onChange={e => setDatos({...datos, costoUSD: e.target.value})} /></div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase text-brand-gold-deep">Margen %</Label><Input className="h-12 font-black text-lg text-brand-gold-deep bg-white" value={datos.margen} onChange={e => recalcularTridireccional('margen', e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase text-status-success">Venta ($)</Label><Input className="h-12 font-black text-lg text-status-success bg-white" value={datos.precioUSD} onChange={e => recalcularTridireccional('precioUSD', e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-[9px] font-black uppercase text-ink">Venta (BS)</Label><Input className="h-12 font-black text-lg bg-white" value={datos.precioBS} onChange={e => recalcularTridireccional('precioBS', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="space-y-1">
                   <Label className="text-[10px] font-black uppercase text-ink/40">Precio al Mayor ($)</Label>
                   <Input className="h-11 font-black bg-white" value={datos.precioMayorUSD} onChange={e => validarDecimal(e.target.value) && setDatos({...datos, precioMayorUSD: e.target.value})} placeholder="0.00" />
                 </div>
                 <div className="space-y-1">
                   <Label className="text-[10px] font-black uppercase text-ink/40">Precio Promoción ($)</Label>
                   <Input className="h-11 font-black bg-white" value={datos.precioPromoUSD} onChange={e => validarDecimal(e.target.value) && setDatos({...datos, precioPromoUSD: e.target.value})} placeholder="0.00" />
                 </div>
                 <div className="space-y-1">
                   <Label className="text-[10px] font-black uppercase text-ink/40">Precio Descuento ($)</Label>
                   <Input className="h-11 font-black bg-white" value={datos.precioOfertaUSD} onChange={e => validarDecimal(e.target.value) && setDatos({...datos, precioOfertaUSD: e.target.value})} placeholder="0.00" />
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'kit' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 p-4 bg-ink text-white rounded-xl">
                <div className="flex items-center gap-3">
                  <button onClick={() => setDatos({...datos, isKit: !datos.isKit})} className={`w-12 h-6 rounded-full transition-all relative ${datos.isKit ? 'bg-brand-gold' : 'bg-white/20'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${datos.isKit ? 'right-1' : 'left-1'}`} /></button>
                  <Label className="text-[11px] font-black uppercase tracking-widest cursor-pointer" onClick={() => setDatos({...datos, isKit: !datos.isKit})}>Habilitar KIT / COMBO</Label>
                </div>

                {datos.isKit && (
                   <div className="space-y-2 pt-2 border-t border-white/10">
                      <Label className="text-[9px] font-black uppercase opacity-40">Tipo de Gestión de Stock</Label>
                      <div className="flex gap-4">
                         <button onClick={() => setDatos({...datos, kitType: 'stock_propio'})} className={`flex-1 py-2 px-3 rounded-lg border text-[10px] font-black uppercase transition-all ${datos.kitType === 'stock_propio' ? 'bg-brand-gold text-ink border-brand-gold' : 'bg-white/5 border-white/20 text-white/40'}`}>Stock Propio</button>
                         <button onClick={() => setDatos({...datos, kitType: 'stock_componentes'})} className={`flex-1 py-2 px-3 rounded-lg border text-[10px] font-black uppercase transition-all ${datos.kitType === 'stock_componentes' ? 'bg-brand-gold text-ink border-brand-gold' : 'bg-white/5 border-white/20 text-white/40'}`}>Stock Virtual</button>
                      </div>
                   </div>
                )}
              </div>
              {datos.isKit && (
                <div className="space-y-4">
                  <div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-ink/30" /><Input className="h-12 pl-10 text-xs font-black uppercase bg-white" placeholder="Buscar productos componentes..." value={kitSearch} onChange={e => setKitSearch(e.target.value)} />{(filteredProdsForKit || []).length > 0 && (<div className="absolute top-full left-0 right-0 bg-white border border-line rounded-lg shadow-2xl z-50 mt-1 overflow-hidden">{filteredProdsForKit.map(pk => (<div key={pk.id} onClick={() => { setDatos({...datos, kitItems: [...datos.kitItems, { productoId: pk.id, nombre: pk.nombre, cantidad: 1 }]}); setKitSearch(''); }} className="p-3 border-b border-line hover:bg-brand-gold-soft cursor-pointer flex justify-between items-center"><span className="text-xs font-black uppercase text-ink">{pk.nombre}</span><PlusCircle className="w-4 h-4 text-brand-gold"/></div>))}</div>)}</div>
                  <Card className="border-line shadow-sm overflow-hidden bg-white"><div className="table-wrap"><table><thead className="bg-surface-soft"><tr><th className="text-[10px] font-black uppercase text-ink">Componente</th><th className="text-[10px] font-black uppercase text-center text-ink">Cant</th><th /></tr></thead><tbody>
                    {datos.kitItems.map((ki: KitItem, index: number) => (
                      <tr key={index} className="border-b border-line/30"><td className="text-[11px] font-black uppercase text-ink">{ki.nombre}</td><td className="text-center"><Input className="w-12 h-8 text-center font-black bg-surface-soft border-line inline-block" type="number" value={ki.cantidad} onChange={e => { const n = [...datos.kitItems]; n[index].cantidad = parseInt(e.target.value) || 1; setDatos({...datos, kitItems: n}); }} /></td><td className="text-center"><button onClick={() => setDatos({...datos, kitItems: (datos.kitItems || []).filter((_:any, i:number) => i !== index)})} className="text-status-danger"><Trash2 className="w-4 h-4"/></button></td></tr>
                    ))}
                  </tbody></table></div></Card>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot p-5 bg-surface-soft border-t border-line flex justify-end gap-3"><Button variant="secondary" className="px-8 font-black uppercase text-[10px]" onClick={onClose}>Cerrar</Button><Button className="bg-brand-gold hover:bg-brand-gold-deep text-ink px-10 font-black uppercase text-[10px] shadow-lg" onClick={handleSave}>{producto ? 'ACTUALIZAR' : 'CREAR PRODUCTO'}</Button></div>
      </div>
    </div>
  );
}
