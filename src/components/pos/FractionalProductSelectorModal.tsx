"use client";
import React, { useMemo, useState } from "react";
import { Product, ProductPresentation } from "@/lib/types";
import { X, Scale, Droplets, Layers, Check } from "lucide-react";
import { Utils } from "@/lib/db-store";

export type PresentationSaleSelection = { nombre?: string; presentacion?: string; factorPresentacion?: number; cantidad: number; precioUnitUSD: number; subtotalUSD: number; cantidadGramos?: number; ventaLibreBS?: boolean };

export default function FractionalProductSelectorModal({ product, rate, stock, onClose, onConfirm }: {
  product: Product; rate: number; stock: number; onClose: () => void; onConfirm: (selection: PresentationSaleSelection) => void;
}) {
  const presentations = useMemo(() => {
    const configured = (product.presentacionesVenta || []).filter(p => p && p.nombre && Number(p.precioUSD) >= 0);
    // La unidad base se representa con el precio principal del producto; no requiere
    // una presentación comercial "Individual" duplicada en el formulario.
    const base: ProductPresentation = { id: "base", nombre: String(product.cantidad || "Unidad"), factor: 1, precioUSD: Number(product.precioUSD) || 0, precioBS: (Number(product.precioUSD) || 0) * rate };
    return [base, ...configured.filter(p => p.id !== "base" && !/^(unidad individual|unidad suelta|individual)$/i.test(String(p.nombre || "").trim()))];
  }, [product.presentacionesVenta, product.cantidad, product.precioUSD, rate]);
  type Mode = "presentation" | "unit" | "grams" | "kg" | "ml" | "budget";
  const [mode, setMode] = useState<Mode>(product.ventaPorPeso ? "grams" : "presentation");
  const [presentationId, setPresentationId] = useState("base");
  const [quantity, setQuantity] = useState("1");
  const [grams, setGrams] = useState("500");
  const [ml, setMl] = useState("250");
  const [budgetBs, setBudgetBs] = useState("50.00");
  const selected = presentations.find(p => p.id === presentationId) || presentations[0];
  // La presentación base debe tomar siempre el precio de venta vigente del producto;
  // nunca un valor antiguo guardado en la fila de presentación base.
  const isBasePresentation = (p?: ProductPresentation) => !!p && (
    p.id === "base" || /^(unidad|unit|base)$/i.test(String(p.nombre || "").trim())
  );
  const selectedSalePrice = selected
    ? (isBasePresentation(selected) ? Number(product.precioUSD) || 0 : Number(selected.precioUSD) || 0)
    : Number(product.precioUSD) || 0;
  const individualPresentation = presentations.find(p => /unidad individual|unidad suelta|unidad|individual|\bund\b/i.test(p.nombre));
  const supportsVolume = /ml|mililitro|litro|lts|lt\b|\bl\b/i.test([product.cantidad, product.unit, ...presentations.map(p => `${p.nombre} ${p.unidadMedida || p.unidad || ""} ${p.unidadContenido || ""}`)].join(" "));
  const q = Math.max(0, Number(quantity.replace(",", ".")) || 0);
  const rawGrams = Math.max(0, Number(grams.replace(",", ".")) || 0);
  // Admite 350 para gramos o 0.350 como 350 g (equivalente a 0.350 kg).
  const g = rawGrams > 0 && rawGrams < 1 ? rawGrams * 1000 : rawGrams;
  const m = Math.max(0, Number(ml.replace(",", ".")) || 0);
  const budget = Math.max(0, Number(budgetBs.replace(",", ".")) || 0);
  const factor = Math.max(0.000001, Number((mode === "unit" ? individualPresentation?.factor : selected?.factor)) || 1);
  let baseQty = 1, unitPrice = product.precioUSD, total = product.precioUSD, displayName = product.nombre;
  let selectedPresentation: ProductPresentation | undefined;
  if (mode === "presentation" && selected) {
    selectedPresentation = selected;
    baseQty = factor * Math.max(1, q);
    total = selectedSalePrice * Math.max(1, q);
    unitPrice = total / baseQty;
    displayName = `${product.nombre} — ${selected.nombre}`;
  } else if (mode === "unit" && individualPresentation) {
    selectedPresentation = individualPresentation;
    baseQty = factor * Math.max(1, q);
    total = (Number(product.precioUSD) || 0) * Math.max(1, q);
    unitPrice = total / baseQty;
    displayName = `${product.nombre} — ${individualPresentation.nombre}`;
  } else if (mode === "grams") {
    baseQty = g / 1000; total = product.precioUSD * baseQty; unitPrice = product.precioUSD;
    displayName = `${product.nombre} (${g} g)`;
  } else if (mode === "kg") {
    baseQty = q; total = product.precioUSD * q; unitPrice = product.precioUSD;
    displayName = `${product.nombre} (${q} kg)`;
  } else if (mode === "ml") {
    baseQty = m / 1000; total = product.precioUSD * baseQty; unitPrice = product.precioUSD;
    displayName = `${product.nombre} (${m} ml)`;
  } else if (mode === "budget") {
    total = rate > 0 ? budget / rate : 0;
    baseQty = product.precioUSD > 0 ? total / product.precioUSD : 0; unitPrice = product.precioUSD;
    displayName = `${product.nombre} — Bs ${budget.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const invalidStock = baseQty > stock;
  const stockVolumeLabel = (() => { const totalMl = Math.max(0, Math.round(stock * 1000)); const liters = Math.floor(totalMl / 1000); const remainderMl = totalMl % 1000; return `${liters} Lts${remainderMl ? ` ${remainderMl} ml` : ""}`; })();
  const invalid = baseQty <= 0 || total <= 0 || ((mode === "budget") && (rate <= 0 || budget <= 0)) || invalidStock;
  const confirm = () => {
    if (invalid) return;
    onConfirm({
      ...(selectedPresentation && (mode === "presentation" || mode === "unit") ? { presentacion: selectedPresentation.nombre, factorPresentacion: factor } : {}),
      nombre: displayName, cantidad: Number(baseQty.toFixed(6)), precioUnitUSD: unitPrice, subtotalUSD: total,
      ...(mode === "grams" ? { cantidadGramos: Math.round(g) } : {}),
      ...(mode === "budget" ? { ventaLibreBS: true } : {}),
    });
  };
  const modes = [
    { id: "presentation" as Mode, label: "Presentaciones", show: presentations.length > 0 },
    
    { id: "grams" as Mode, label: "Gramos", show: !!product.ventaPorPeso },
    { id: "kg" as Mode, label: "Kilogramos", show: !!product.ventaPorPeso },
    { id: "ml" as Mode, label: "Mililitros", show: supportsVolume },
    { id: "budget" as Mode, label: "Monto en Bs", show: !!product.permiteVentaLibreBS || supportsVolume },
  ].filter(x => x.show);
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 md:p-6">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
      <header className="flex items-center justify-between bg-[#1b4e8c] px-5 py-3.5 text-white"><div className="flex items-center gap-2"><Layers className="h-5 w-5 text-blue-200"/><div><h2 className="text-base font-bold">{product.nombre}</h2><p className="text-xs text-blue-200">Selecciona presentación, peso o fracción a despachar</p></div></div><button type="button" onClick={onClose} aria-label="Cerrar"><X className="h-5 w-5"/></button></header>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap gap-1.5 border-b pb-3">{modes.map(item=><button key={item.id} type="button" onClick={()=>setMode(item.id)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${mode===item.id?"bg-[#1b4e8c] text-white":"bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{item.label}</button>)}</div>
        
        {mode==="presentation" && <div className="space-y-3"><label className="block text-xs font-bold text-slate-700">Presentación disponible</label><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{presentations.map(p=><button key={p.id} type="button" onClick={()=>setPresentationId(p.id)} className={`rounded-lg border p-3 text-left ${presentationId===p.id?"border-[#1b4e8c] bg-blue-50 ring-1 ring-[#1b4e8c]":"border-slate-200 hover:border-slate-400"}`}><span className="block text-sm font-bold">{p.nombre}</span><span className="block text-xs text-slate-500">{p.contenido ? `${p.contenido} ${p.unidadContenido || ""}` : `Factor inventario: ${p.factor}`}</span><span className="mt-1 block text-base font-black text-[#1b4e8c]">{Utils.fmtUSD(isBasePresentation(p) ? (Number(product.precioUSD)||0) : (Number(p.precioUSD)||0))}</span>{p.codigoBarras&&<span className="block text-[10px] text-slate-400">Cód. {p.codigoBarras}</span>}</button>)}</div><label className="block text-xs font-bold">Cantidad de presentaciones<input type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3"/></label></div>}
        {mode==="grams"&&<div className="space-y-2"><label className="flex items-center gap-2 text-xs font-bold"><Scale className="h-4 w-4"/> Peso a vender (gramos)</label><input type="number" min="1" max={Math.floor(stock*1000)} step="1" value={grams} onChange={e=>setGrams(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-lg font-bold"/><div className="flex flex-wrap gap-2">{[100,250,500,750,1000].map(v=><button key={v} type="button" onClick={()=>setGrams(String(v))} className="rounded-md border px-2 py-1 text-xs">{v} g</button>)}</div><p className="text-xs text-slate-500">Precio base: {Utils.fmtUSD(product.precioUSD)} / kg. Puedes indicar 350 g o 0.350 kg.</p></div>}
        {mode==="kg"&&<label className="block text-xs font-bold">Cantidad en kilogramos<input type="number" min="0.001" max={stock} step="0.001" value={quantity} onChange={e=>setQuantity(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-lg font-bold"/></label>}
        {mode==="ml"&&<div className="space-y-2"><label className="flex items-center gap-2 text-xs font-bold"><Droplets className="h-4 w-4"/> Volumen a vender (ml)</label><input type="number" min="1" step="1" value={ml} onChange={e=>setMl(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-lg font-bold"/><div className="flex flex-wrap gap-2">{[100,250,500,750,1000].map(v=><button key={v} type="button" onClick={()=>setMl(String(v))} className="rounded-md border px-2 py-1 text-xs">{v} ml</button>)}</div><p className="text-xs text-slate-500">Precio base: {Utils.fmtUSD(product.precioUSD)} / litro</p></div>}
        {mode==="budget"&&<div className="space-y-2"><label className="block text-xs font-bold">Importe a despachar en bolívares (Bs)</label><input type="number" min="0.01" step="0.01" value={budgetBs} onChange={e=>setBudgetBs(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-lg font-bold"/><p className="text-xs text-slate-500">Tasa aplicada: {Utils.fmtBS(rate)} Bs/USD</p></div>}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between text-xs text-slate-500"><span>Stock disponible</span><strong>{product.ventaPorPeso ? (() => { const totalGrams = Math.max(0, Math.round(stock * 1000)); const kg = Math.floor(totalGrams / 1000); const gramsLeft = totalGrams % 1000; return `${kg} kg${gramsLeft ? ` ${gramsLeft} g` : ""}`; })() : supportsVolume ? stockVolumeLabel : `${stock} ${product.cantidad || "unidades base"}`}</strong></div><div className="mt-3 flex items-center justify-between"><span className="text-sm font-bold">Total estimado</span><strong className="text-xl font-black text-[#1b4e8c]">{Utils.fmtUSD(total)}</strong></div><div className="mt-1 flex items-center justify-between text-sm"><span>Equivalente Bs</span><strong>{Utils.fmtBS(total*rate)}</strong></div>{invalidStock&&<p className="mt-2 text-xs font-bold text-red-600">No hay suficiente existencia para esta presentación.</p>}{(mode==="grams"||mode==="kg")&&baseQty>stock&&<p className="mt-2 text-xs font-bold text-red-600">La cantidad supera el stock disponible.</p>}</div>
      </div>
      <footer className="flex justify-end gap-2 border-t bg-slate-50 p-4"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-bold text-slate-600">Cancelar</button><button type="button" disabled={invalid} onClick={confirm} className="flex items-center gap-2 rounded-lg bg-[#1b4e8c] px-5 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-4 w-4"/>Añadir al carrito</button></footer>
    </div>
  </div>;
}
