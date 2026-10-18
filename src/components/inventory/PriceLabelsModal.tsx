"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
const JsBarcode: any = require("jsbarcode");
import { jsPDF } from "jspdf";
import { Product, AppState, getProductBarcode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Printer, FileDown, Search, Tag } from "lucide-react";

type Props = { productos: Product[]; state: AppState; onClose: () => void };
type VatMode = "ambos" | "con" | "sin";
type Paper = "estante" | "pequena";
type PriceTier = "estandar" | "mayor" | "oferta" | "promo";

const barcodeFormat = (value: string) =>
  /^\d{13}$/.test(value) ? "EAN13" : /^\d{8}$/.test(value) ? "EAN8" : /^\d{12}$/.test(value) ? "UPC" : "CODE128";

function BarcodePreview({ value, small = false }: { value: string; small?: boolean }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value || "SIN-CODIGO", {
        format: barcodeFormat(value),
        displayValue: false,
        height: small ? 26 : 40,
        margin: 0,
        width: small ? 1.1 : 1.5,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = "";
    }
  }, [value, small]);
  return <svg ref={svgRef} role="img" aria-label={`Código de barras ${value}`} className="w-full max-w-[230px] h-[40px]" />;
}

export function PriceLabelsModal({ productos, state, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantity, setQuantity] = useState<Record<string, number>>({});
  const [vatMode, setVatMode] = useState<VatMode>("ambos");
  const [includeBarcode, setIncludeBarcode] = useState(true);
  const [paper, setPaper] = useState<Paper>("estante");
  const [priceTier, setPriceTier] = useState<PriceTier>("estandar");
  const [showPrice, setShowPrice] = useState(true);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return productos.filter((p) => p.activo && (
      p.nombre.toLowerCase().includes(term) ||
      (p.codigo || "").toLowerCase().includes(term) ||
      (p.barcode || "").toLowerCase().includes(term) ||
      (p.marca || "").toLowerCase().includes(term)
    ));
  }, [productos, query]);

  const picked = productos.filter((p) => selected[p.id] && p.activo);
  const ivaRate = Number(state.config?.ivaRate) > 0 ? Number(state.config.ivaRate) / 100 : 0.16;
  const basePrice = (p: Product) => {
    const selectedPrice = priceTier === "mayor" ? p.precioMayorUSD
      : priceTier === "oferta" ? p.precioOfertaUSD
      : priceTier === "promo" ? p.precioPromoUSD
      : p.precioEstandarUSD;
    return Math.max(0, Number(selectedPrice) || Number(p.precioUSD) || 0);
  };
  const priceUSD = (p: Product, withVat: boolean) =>
    basePrice(p) * (withVat && p.aplicaIVA ? 1 + ivaRate : 1);
  const modes: boolean[] = vatMode === "ambos" ? [false, true] : [vatMode === "con"];
  const money = (v: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const tierName = ({ estandar: "DETAL / MOSTRADOR", mayor: "MAYORISTA", oferta: "OFERTA", promo: "PROMOCIÓN" } as const)[priceTier];
  const identifier = (p: Product) => getProductBarcode(p) || p.id;
  const unitName = (p: Product) => (p.unit || p.cantidad || "UND").toString().toUpperCase();
  const companyName = state.empresa?.nombre || "POSVEN-PRO3";
  const locationName = (p: Product) => p.warehouse || p.departamento || "GENERAL";

  const barcodeData = (value: string) => {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value || "SIN-CODIGO", {
      format: barcodeFormat(value), displayValue: true, fontSize: 10, height: 42,
      margin: 0, width: 1.5, background: "#ffffff", lineColor: "#000000",
    });
    return canvas.toDataURL("image/png");
  };

  const makePdf = () => {
    if (!picked.length) { alert("Selecciona al menos un producto y la cantidad de etiquetas."); return; }
    const w = paper === "estante" ? 90 : 50;
    const h = paper === "estante" ? 55 : 30;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [w, h] });
    let first = true;
    picked.forEach((p) => {
      const copies = Math.max(1, Math.min(500, Number(quantity[p.id]) || 1));
      for (let copy = 0; copy < copies; copy++) {
        modes.forEach((withVat) => {
          if (!first) doc.addPage([w, h], "landscape");
          first = false;
          doc.setDrawColor(35); doc.setLineWidth(0.35); doc.rect(1.5, 1.5, w - 3, h - 3);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(paper === "estante" ? 5.8 : 4.2);
          doc.text(companyName.slice(0, 34), 3, 5);
          doc.text(("PASILLO " + locationName(p)).slice(0, 24), w - 3, 5, { align: "right" });
          doc.setDrawColor(35); doc.line(3, 6.5, w - 3, 6.5);
          doc.setFontSize(paper === "estante" ? 8.2 : 5.5);
          const name = doc.splitTextToSize(p.nombre.toUpperCase(), w - 7);
          doc.text(name.slice(0, paper === "estante" ? 2 : 1), 3, paper === "estante" ? 11 : 10);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(paper === "estante" ? 5.2 : 3.8);
          doc.text(((p.marca || "") + " · " + (p.categoria || p.departamento || "")).slice(0, 55), 3, paper === "estante" ? 17 : 13);
          if (showPrice) {
            const boxY = paper === "estante" ? 19 : 14.5;
            const boxH = paper === "estante" ? 10 : 5.5;
            doc.setFillColor(16, 34, 43); doc.roundedRect(3, boxY, w - 6, boxH, 1, 1, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(paper === "estante" ? 5 : 3.2);
            doc.text(tierName + (withVat ? " (IVA INCL.)" : " (SIN IVA)"), 5, boxY + (paper === "estante" ? 3.5 : 2.2));
            doc.setFont("helvetica", "bold");
            doc.setFontSize(paper === "estante" ? 12 : 6.8);
            doc.text("US$ " + money(priceUSD(p, withVat)), w - 5, boxY + (paper === "estante" ? 8.1 : 4.8), { align: "right" });
            doc.setTextColor(0, 0, 0);
          }
          const bcY = paper === "estante" ? (showPrice ? 31 : 20) : (showPrice ? 21 : 15);
          if (includeBarcode) {
            try { doc.addImage(barcodeData(identifier(p)), "PNG", 4, bcY, w - 8, paper === "estante" ? 10 : 5); } catch (e) { console.error("No se pudo generar el código de barras", e); }
          }
          doc.setFont("helvetica", "bold"); doc.setFontSize(paper === "estante" ? 5.5 : 3.6);
          doc.text(("SKU: " + identifier(p)).slice(0, 45), w / 2, h - 5.5, { align: "center" });
          doc.setFont("helvetica", "normal"); doc.setFontSize(paper === "estante" ? 4.5 : 3);
          doc.text(("REF: " + p.codigo + " · UND: " + unitName(p)).slice(0, 50), w / 2, h - 3, { align: "center" });
        });
      }
    });
    doc.save("etiquetas-habladores-posven.pdf");
  };

  const printLabels = () => {
    if (!picked.length) { alert("Selecciona al menos un producto y la cantidad de etiquetas."); return; }
    const w = paper === "estante" ? 90 : 50;
    const h = paper === "estante" ? 55 : 30;
    const labels = picked.flatMap((p) => {
      const count = Math.max(1, Math.min(500, Number(quantity[p.id]) || 1));
      return Array.from({ length: count }, () => p).flatMap((item) => modes.map((withVat) => {
        const id = identifier(item);
        const barcode = includeBarcode ? '<img class="hab-barcode" src="' + barcodeData(id) + '" alt="Código de barras">' : "";
        return '<article class="hablador ' + (paper === "estante" ? "shelf" : "small-label") + '">' +
          '<div class="hab-top"><span>' + esc(companyName) + '</span><span>PASILLO ' + esc(locationName(item)) + '</span></div>' +
          '<div class="hab-product"><div class="hab-info"><div class="hab-desc">' + esc(item.nombre) + '</div>' +
          '<div class="hab-meta"><b>' + esc(item.marca || "") + '</b> · ' + esc(item.categoria || item.departamento || "") + '</div></div></div>' +
          (showPrice ? '<div class="hab-price-box"><span>' + esc(tierName) + (withVat ? " (IVA INCL.)" : " (SIN IVA)") + '</span><b>US$ ' + money(priceUSD(item, withVat)) + '</b></div>' : '') +
          (includeBarcode ? '<div class="hab-bc">' + barcode + '</div>' : '') +
          '<div class="hab-sku">SKU: ' + esc(id) + '</div><div class="hab-ref">EAN/REF: ' + esc(item.codigo || id) + ' · UND: ' + esc(unitName(item)) + '</div></article>';
      }));
    }).join("");
    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) { alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo de nuevo."); return; }
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas y habladores</title><style>' +
      '*{box-sizing:border-box}body{margin:0;padding:4mm;font-family:Arial,sans-serif;display:flex;flex-wrap:wrap;align-content:flex-start;gap:2mm;color:#10222B}' +
      '.hablador{width:340px;min-height:210px;background:#fff;color:#10222B;border:3px solid #10222B;border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;overflow:hidden;page-break-inside:avoid}' +
      '.hablador.small-label{width:280px;border-width:2px}.hab-top{display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #10222B;padding-bottom:3px;font-size:11px;font-weight:700;letter-spacing:.04em;gap:4px}' +
      '.hab-product{display:flex;gap:8px;align-items:center;min-height:40px}.hab-info{flex:1;min-width:0}.hab-desc{font:700 15px/1.2 Arial,sans-serif;margin-top:2px;text-transform:uppercase;overflow-wrap:anywhere}.hab-meta{font-size:11.5px;color:#52616A;overflow-wrap:anywhere}' +
      '.hab-price-box{margin:4px 0;padding:6px 10px;background:#10222B;color:#fff;display:flex;justify-content:space-between;align-items:baseline;gap:6px;border-radius:4px}.hab-price-box span{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#C9D6DD}.hab-price-box b{font:700 24px/1 Arial,sans-serif;color:#FFD21F;white-space:nowrap}' +
      '.hab-bc{display:flex;flex-direction:column;align-items:center;margin-top:2px;padding-top:4px;border-top:1px dashed #ccd3d7}.hab-barcode{width:78%;max-width:230px;height:40px;object-fit:fill}.hab-sku{font:700 12px monospace;letter-spacing:.06em;margin-top:2px;text-align:center;overflow-wrap:anywhere}.hab-ref{font-size:10px;color:#555;text-align:center;overflow-wrap:anywhere}' +
      '@page{size:auto;margin:4mm}@media print{body{padding:0;gap:2mm}.hablador{width:' + w + 'mm;height:' + h + 'mm;min-height:0;padding:2mm;border-radius:0;gap:1mm;border-width:' + (paper === "estante" ? ".7mm" : ".4mm") + '}.hab-top{font-size:' + (paper === "estante" ? "5.5pt" : "3.8pt") + ';padding-bottom:.5mm}.hab-desc{font-size:' + (paper === "estante" ? "8pt" : "5pt") + ';line-height:1.1}.hab-meta{font-size:' + (paper === "estante" ? "5pt" : "3.5pt") + '}.hab-price-box{margin:.5mm 0;padding:1mm 1.5mm}.hab-price-box span{font-size:' + (paper === "estante" ? "4.5pt" : "2.8pt") + '}.hab-price-box b{font-size:' + (paper === "estante" ? "13pt" : "6pt") + '}.hab-bc{margin-top:0;padding-top:.5mm}.hab-barcode{height:' + (paper === "estante" ? "10mm" : "4.8mm") + ';width:76%}.hab-sku{font-size:' + (paper === "estante" ? "5pt" : "3pt") + ';margin-top:0}.hab-ref{font-size:' + (paper === "estante" ? "4pt" : "2.6pt") + '}}' +
      '</style></head><body>' + labels + '</body></html>');
    win.document.close(); win.focus(); setTimeout(() => win.print(), 500);
  };

  const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  return <div className="modal show z-[100]">
    <div className="modal-bg" onClick={onClose} />
    <div className="modal-box bg-white max-w-6xl w-[96vw] max-h-[94vh] overflow-hidden rounded-xl border-2 border-line shadow-2xl">
      <div className="modal-head bg-ink text-white px-5 py-4 flex items-center justify-between">
        <h3 className="font-black uppercase text-sm flex items-center gap-2"><Tag className="w-5 h-5 text-brand-gold" /> Generador de Etiquetas y Habladores de SKU</h3>
        <button onClick={onClose} aria-label="Cerrar"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-4 overflow-y-auto max-h-[78vh]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="text-xs font-bold block mb-1">Buscar productos</label><div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-ink/40" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre, SKU, marca o código de barras" /></div></div>
          <div><label className="text-xs font-bold block mb-1">Formato de diseño</label><select className="form-select h-10 w-full" value={paper} onChange={(e) => setPaper(e.target.value as Paper)}><option value="estante">Hablador de mostrador / estante (90 × 55 mm)</option><option value="pequena">Etiqueta adhesiva de SKU (50 × 30 mm)</option></select></div>
          <div><label className="text-xs font-bold block mb-1">Escala de precio</label><select className="form-select h-10 w-full" value={priceTier} onChange={(e) => setPriceTier(e.target.value as PriceTier)}><option value="estandar">Detal / Mostrador</option><option value="mayor">Mayorista</option><option value="oferta">Oferta</option><option value="promo">Promoción</option></select></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Mostrar precio US$</label>
          <label className="flex items-center gap-2"><span>Precios a imprimir</span><select className="form-select h-9" value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)}><option value="ambos">Con y sin IVA</option><option value="con">Solo con IVA</option><option value="sin">Solo sin IVA</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeBarcode} onChange={(e) => setIncludeBarcode(e.target.checked)} /> Incluir código de barras (lectura por escáner)</label>
          <span className="text-xs text-ink/60">IVA según la configuración fiscal del producto.</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="secondary" onClick={() => { const next = { ...selected }; filtered.forEach((p) => { next[p.id] = true; }); setSelected(next); }}>Seleccionar resultados</Button>
          <Button variant="secondary" onClick={() => setSelected({})}>Limpiar selección</Button>
          <span className="self-center text-xs font-bold text-ink/60">{picked.length} productos · {picked.reduce((n, p) => n + Math.max(1, Math.min(500, Number(quantity[p.id]) || 1)) * modes.length, 0)} etiquetas a generar</span>
        </div>
        <div className="border border-line rounded-lg overflow-auto max-h-[32vh]">
          <table className="w-full text-sm"><thead className="bg-surface-soft sticky top-0"><tr><th className="p-2 text-left">Producto</th><th className="p-2">SKU / Código</th><th className="p-2">Precio USD</th><th className="p-2">Cantidad</th></tr></thead>
            <tbody>{filtered.map((p) => <tr key={p.id} className="border-t border-line/50">
              <td className="p-2"><label className="flex gap-2 items-center"><input type="checkbox" checked={!!selected[p.id]} onChange={(e) => setSelected({ ...selected, [p.id]: e.target.checked })} /><span>{p.nombre}</span></label></td>
              <td className="p-2 text-center font-mono text-xs">{identifier(p)}</td>
              <td className="p-2 text-center">{money(priceUSD(p, vatMode !== "sin"))}</td>
              <td className="p-2"><Input className="w-20 mx-auto" type="number" min="1" max="500" value={quantity[p.id] ?? 1} onChange={(e) => setQuantity({ ...quantity, [p.id]: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap justify-between items-center gap-2"><h4 className="font-black text-sm uppercase tracking-wide">Vista previa de impresión</h4><span className="text-xs text-ink/60">Diseño igual al documento impreso · {paper === "estante" ? "90 × 55 mm" : "50 × 30 mm"}</span></div>
          <div className="hablador-wrap flex flex-wrap justify-center gap-3 p-3 bg-surface-soft border border-line rounded-lg max-h-[360px] overflow-auto">
            {picked.length === 0 ? <p className="text-sm text-ink/60 p-8 text-center w-full">Selecciona uno o más productos para ver aquí sus etiquetas y habladores.</p> :
              picked.flatMap((p) => modes.map((withVat, i) => <article key={p.id + "-" + i} className={`hablador ${paper === "estante" ? "shelf" : "small-label"}`}>
                <div className="hab-top"><span>{companyName}</span><span>PASILLO {locationName(p)}</span></div>
                <div className="hab-product"><div className="hab-info"><div className="hab-desc">{p.nombre}</div><div className="hab-meta"><b>{p.marca || ""}</b> · {p.categoria || p.departamento || ""}</div></div></div>
                {showPrice && <div className="hab-price-box"><span>{tierName} {withVat ? "(IVA INCL.)" : "(SIN IVA)"}</span><b>US$ {money(priceUSD(p, withVat))}</b></div>}
                {includeBarcode && <div className="hab-bc"><BarcodePreview value={identifier(p)} small={paper === "pequena"} /></div>}
                <div className="hab-sku">SKU: {identifier(p)}</div>
                <div className="hab-ref">EAN/REF: {p.codigo || identifier(p)} · UND: {unitName(p)}</div>
              </article>))
            }
          </div>
          <p className="text-xs text-ink/60">La vista previa conserva el diseño, el precio fiscal seleccionado, el SKU y el código de barras que se enviarán a impresión o PDF.</p>
        </div>
      </div>
      <div className="modal-foot bg-surface-soft border-t border-line p-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        <Button variant="secondary" onClick={printLabels}><Printer className="w-4 h-4 mr-2" /> Imprimir</Button>
        <Button onClick={makePdf} className="bg-brand-gold text-ink hover:bg-brand-gold-deep"><FileDown className="w-4 h-4 mr-2" /> Descargar PDF</Button>
      </div>
    </div>
    <style jsx>{`
      .hablador-wrap{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding:12px;background:var(--panel-2,#f3f4f6);border:1px solid var(--line,#d1d5db);border-radius:6px;max-height:min(360px,calc(100dvh - 260px));overflow:auto}
      .hablador{width:280px;background:#fff;color:#10222B;border:2px solid #10222B;border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;box-shadow:0 4px 12px rgba(16,34,43,.12)}
      .hablador.shelf{width:340px;border-width:3px}
      .hablador.small-label{width:280px;border-width:2px}
      .hab-top{display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #10222B;padding-bottom:3px;font-size:11px;font-weight:700;letter-spacing:.04em;gap:5px}
      .hab-product{display:flex;gap:8px;align-items:center;min-height:40px}.hab-info{flex:1;min-width:0}
      .hab-desc{font:700 15px/1.2 Arial,sans-serif;margin-top:2px;text-transform:uppercase;overflow-wrap:anywhere}
      .hab-meta{font-size:11.5px;color:#52616A;overflow-wrap:anywhere}
      .hab-price-box{margin:4px 0;padding:6px 10px;background:#10222B;color:#fff;display:flex;justify-content:space-between;align-items:baseline;gap:6px;border-radius:4px}
      .hab-price-box span{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#C9D6DD}
      .hab-price-box b{font:700 24px/1 Arial,sans-serif;letter-spacing:.03em;color:#FFD21F;white-space:nowrap}
      .hab-bc{display:flex;flex-direction:column;align-items:center;margin-top:2px;padding-top:4px;border-top:1px dashed #ccd3d7}
      .hab-sku{font:700 12px monospace;letter-spacing:.06em;margin-top:2px;text-align:center;overflow-wrap:anywhere}
      .hab-ref{font-size:10px;color:#555;text-align:center;overflow-wrap:anywhere}
      @media(max-width:640px){.hablador{width:100%;max-width:340px}.hablador.small-label{max-width:280px}.hab-price-box b{font-size:21px}}
    `}</style>
  </div>;
}
