"use client";

import React, { useMemo, useState } from "react";
const JsBarcode: any = require("jsbarcode");
import { jsPDF } from "jspdf";
import { Product, AppState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Printer, FileDown, Search, Tag } from "lucide-react";

type Props = { productos: Product[]; state: AppState; onClose: () => void };
type VatMode = "ambos" | "con" | "sin";

export function PriceLabelsModal({ productos, state, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantity, setQuantity] = useState<Record<string, number>>({});
  const [vatMode, setVatMode] = useState<VatMode>("ambos");
  const [includeBarcode, setIncludeBarcode] = useState(true);
  const [paper, setPaper] = useState<"estante" | "pequena">("estante");
  const filtered = useMemo(() => productos.filter(p => p.activo && (p.nombre.toLowerCase().includes(query.toLowerCase()) || p.codigo.toLowerCase().includes(query.toLowerCase()))), [productos, query]);
  const picked = productos.filter(p => selected[p.id] && p.activo);
  const copies = picked.flatMap(p => Array.from({ length: Math.max(1, Math.min(500, Number(quantity[p.id]) || 1)) }, () => p));
  const ivaRate = Number(state.config?.ivaRate) > 0 ? Number(state.config.ivaRate) / 100 : 0.16;
  const priceBS = (p: Product, withVat: boolean) => {
    const base = (Number(p.precioUSD) || 0) * (Number(state.tasa) || 1);
    return base * (withVat && p.aplicaIVA ? 1 + ivaRate : 1);
  };
  const modes = vatMode === "ambos" ? [false, true] : [vatMode === "con"];
  const money = (v: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const barcodeFormat = (value: string) => /^\\d{13}$/.test(value) ? "EAN13" : /^\\d{8}$/.test(value) ? "EAN8" : /^\\d{12}$/.test(value) ? "UPC" : "CODE128";
  const barcodeData = (value: string) => {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value || "SIN-CODIGO", { format: barcodeFormat(value), displayValue: true, fontSize: 10, height: 42, margin: 0, width: 1.5, background: "#ffffff", lineColor: "#000000" });
    return canvas.toDataURL("image/png");
  };
  const makePdf = () => {
    if (!copies.length) { alert("Selecciona al menos un producto y la cantidad de etiquetas."); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: paper === "estante" ? [90, 55] : [50, 30] });
    let first = true;
    copies.forEach((p) => modes.forEach(withVat => {
      if (!first) doc.addPage(paper === "estante" ? [90, 55] : [50, 30], "landscape");
      first = false;
      const w = paper === "estante" ? 90 : 50;
      const h = paper === "estante" ? 55 : 30;
      doc.setDrawColor(35); doc.setLineWidth(0.35); doc.rect(1.5, 1.5, w - 3, h - 3);
      doc.setFont("helvetica", "bold"); doc.setFontSize(paper === "estante" ? 9 : 6.5);
      const name = doc.splitTextToSize(p.nombre.toUpperCase(), w - 8);
      doc.text(name.slice(0, paper === "estante" ? 2 : 1), 4, 7);
      doc.setFontSize(paper === "estante" ? 17 : 10);
      doc.text("Bs. " + money(priceBS(p, withVat)), 4, paper === "estante" ? 24 : 16);
      doc.setFont("helvetica", "normal"); doc.setFontSize(paper === "estante" ? 7 : 5);
      doc.text(withVat ? "PRECIO CON IVA" : "PRECIO SIN IVA", 4, paper === "estante" ? 29 : 20);
      doc.text("USD " + money(Number(p.precioUSD) || 0), 4, paper === "estante" ? 34 : 24);
      if (includeBarcode) {
        try { doc.addImage(barcodeData(p.barcode || p.codigo || p.id), "PNG", 4, paper === "estante" ? 36 : 24.5, paper === "estante" ? 55 : 31, paper === "estante" ? 13 : 4.5); } catch (e) { console.error("No se pudo generar el código de barras", e); }
      }
    }));
    doc.save("habladores-precios-posven.pdf");
  };
  const printLabels = () => {
    if (!copies.length) { alert("Selecciona al menos un producto y la cantidad de etiquetas."); return; }
    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) { alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo de nuevo."); return; }
    const w = paper === "estante" ? 90 : 50;
    const h = paper === "estante" ? 55 : 30;
    const labels = copies.flatMap(p => modes.map(withVat => {
      let barcode = "";
      if (includeBarcode) {
        const canvas = document.createElement("canvas");
        JsBarcode(canvas, p.barcode || p.codigo || p.id, { format: barcodeFormat(p.barcode || p.codigo || p.id), displayValue: true, fontSize: 10, height: 35, margin: 0, width: 1.3 });
        barcode = '<img class="barcode" src="' + canvas.toDataURL("image/png") + '">';
      }
      return '<article class="label"><strong class="name">' + esc(p.nombre) + '</strong><strong class="price">Bs. ' + money(priceBS(p, withVat)) + '</strong><span class="tax">' + (withVat ? "PRECIO CON IVA" : "PRECIO SIN IVA") + '</span><span class="usd">USD ' + money(Number(p.precioUSD) || 0) + '</span>' + barcode + '</article>';
    })).join("");
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Habladores de precios</title><style>@page{size:auto;margin:4mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;display:grid;grid-template-columns:repeat(auto-fit,' + w + 'mm);gap:2mm}.label{width:' + w + 'mm;height:' + h + 'mm;border:.3mm solid #222;padding:2mm;display:flex;flex-direction:column;overflow:hidden;page-break-inside:avoid}.name{font-size:' + (paper === "estante" ? "9pt" : "6pt") + ';max-height:9mm;overflow:hidden}.price{font-size:' + (paper === "estante" ? "18pt" : "10pt") + ';margin-top:1mm}.tax,.usd{font-size:6pt}.barcode{width:60%;height:12mm;object-fit:fill;margin-top:auto}</style></head><body>' + labels + '</body></html>');
    win.document.close(); win.focus(); setTimeout(() => win.print(), 500);
  };
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  return <div className="modal show z-[100]"><div className="modal-bg" onClick={onClose}/><div className="modal-box bg-white max-w-5xl w-[96vw] max-h-[92vh] overflow-hidden rounded-xl border-2 border-line shadow-2xl">
    <div className="modal-head bg-ink text-white px-5 py-4 flex items-center justify-between"><h3 className="font-black uppercase text-sm flex items-center gap-2"><Tag className="w-5 h-5 text-brand-gold"/> Habladores y etiquetas de precios</h3><button onClick={onClose}><X className="w-5 h-5"/></button></div>
    <div className="p-5 space-y-4 overflow-y-auto max-h-[72vh]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div><label className="text-xs font-bold block mb-1">Buscar productos</label><div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-ink/40"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre, SKU o código de barras"/></div></div>
        <div><label className="text-xs font-bold block mb-1">Precios a imprimir</label><select className="form-select h-10 w-full" value={vatMode} onChange={e=>setVatMode(e.target.value as VatMode)}><option value="ambos">Ambos: con y sin IVA</option><option value="con">Solo con IVA</option><option value="sin">Solo sin IVA</option></select></div>
        <div><label className="text-xs font-bold block mb-1">Formato de etiqueta</label><select className="form-select h-10 w-full" value={paper} onChange={e=>setPaper(e.target.value as "estante"|"pequena")}><option value="estante">Hablador estante 90 × 55 mm</option><option value="pequena">Etiqueta pequeña 50 × 30 mm</option></select></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeBarcode} onChange={e=>setIncludeBarcode(e.target.checked)}/> Incluir código de barras Code 128 (lectura por escáner)</label>
      <div className="flex gap-2"><Button variant="secondary" onClick={()=>{const next={...selected};filtered.forEach(p=>next[p.id]=true);setSelected(next)}}>Seleccionar resultados</Button><Button variant="secondary" onClick={()=>setSelected({})}>Limpiar selección</Button><span className="self-center text-xs font-bold text-ink/60">{picked.length} productos · {copies.length * modes.length} etiquetas a generar</span></div>
      <div className="border border-line rounded-lg overflow-auto max-h-[42vh]"><table className="w-full text-sm"><thead className="bg-surface-soft sticky top-0"><tr><th className="p-2 text-left">Producto</th><th className="p-2">SKU / Código</th><th className="p-2">Precio Bs</th><th className="p-2">Cantidad</th></tr></thead><tbody>{filtered.map(p=><tr key={p.id} className="border-t border-line/50"><td className="p-2"><label className="flex gap-2 items-center"><input type="checkbox" checked={!!selected[p.id]} onChange={e=>setSelected({...selected,[p.id]:e.target.checked})}/><span>{p.nombre}</span></label></td><td className="p-2 text-center font-mono">SKU: {p.codigo || "—"}{p.barcode ? " · CB: " + p.barcode : ""}</td><td className="p-2 text-center">{money(priceBS(p,false))}</td><td className="p-2"><Input className="w-20 mx-auto" type="number" min="1" max="500" value={quantity[p.id] ?? 1} onChange={e=>setQuantity({...quantity,[p.id]:Math.max(1,Math.min(500,Number(e.target.value)||1))})}/></td></tr>)}</tbody></table></div>
      <p className="text-xs text-ink/60">El código impreso codifica el SKU/código del producto, que debe ser único y estar registrado en el inventario. Para productos con IVA desactivado, ambos modos muestran el mismo precio fiscalmente correcto.</p>
    </div>
    <div className="modal-foot bg-surface-soft border-t border-line p-4 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button variant="secondary" onClick={printLabels}><Printer className="w-4 h-4 mr-2"/>Imprimir</Button><Button onClick={makePdf} className="bg-brand-gold text-ink hover:bg-brand-gold-deep"><FileDown className="w-4 h-4 mr-2"/>Descargar PDF</Button></div>
  </div></div>;
}
