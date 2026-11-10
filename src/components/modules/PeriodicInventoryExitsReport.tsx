"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AppState, Movimiento, Product } from "@/lib/types";
import { Store, Utils } from "@/lib/db-store";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type HistoricalValues = { costBs: string; rate: string; productCode: string; productName: string };

export default function PeriodicInventoryExitsReport(_props: { state: AppState }) {
  const today = Utils.hoy();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState<Record<string, HistoricalValues>>({});
  const [source, setSource] = useState<{ movimientos: Movimiento[]; productos: Product[] }>({ movimientos: [], productos: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Store.loadPeriodicInventoryExits(from, to)
      .then(data => { if (active) setSource(data); })
      .catch(error => { if (active) { setSource({ movimientos: [], productos: [] }); setLoadError(String(error?.message || error)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const rows = useMemo(() => (source.movimientos || [])
    .filter(m => Number(m.cantidad) < 0 && m.fecha && m.fecha.slice(0, 10) >= from && m.fecha.slice(0, 10) <= to)
    .map(m => ({ movement: m, product: (source.productos || []).find(p => p.id === m.productoId) }))
    .filter(row => !category || row.product?.categoria === category)
    .filter(row => !search || [row.product?.codigo, row.product?.nombre, row.movement.referencia].some(v => String(v || "").toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => a.movement.fecha.localeCompare(b.movement.fecha)),
  [source.movimientos, source.productos, category, search]);

  const historical = (m: Movimiento): HistoricalValues => {
    const saved = manual[m.id];
    const costBs = Number(m.costoUnitarioBs) > 0
      ? String(m.costoUnitarioBs)
      : Number(m.costoUnitarioUSD) > 0 && Number(m.tasaBCV) > 0
        ? String(Number(m.costoUnitarioUSD) * Number(m.tasaBCV))
        : "";
    return {
      costBs: saved?.costBs ?? costBs,
      rate: saved?.rate ?? (Number(m.tasaBCV) > 0 ? String(m.tasaBCV) : ""),
      productCode: saved?.productCode ?? "",
      productName: saved?.productName ?? "",
    };
  };

  const pending = rows.filter(({ movement, product }) =>
    !String(product?.codigo || manual[movement.id]?.productCode || "").trim() ||
    !(Number(historical(movement).costBs) > 0) ||
    !(Number(historical(movement).rate) > 0)
  ).length;
  const units = rows.reduce((sum, row) => sum + Math.abs(Number(row.movement.cantidad) || 0), 0);

  const setValue = (id: string, field: keyof HistoricalValues, value: string) =>
    setManual(prev => ({ ...prev, [id]: { ...historical(rows.find(r => r.movement.id === id)!.movement), ...prev[id], [field]: value } }));

  const exportRows = () => rows.map(({ movement: m, product: p }) => ({
    productCode: p?.codigo || historical(m).productCode,
    productName: p?.nombre || historical(m).productName || "PRODUCTO NO LOCALIZADO",
    date: m.fecha.slice(0, 10),
    type: "SALIDA",
    concept: m.tipo === "venta" ? "VENTA" : m.tipo === "consumo" || m.tipo === "colaboracion" ? "AUTOCONSUMO" : "OTRA SALIDA",
    documentRef: m.referencia || m.id,
    quantity: Math.abs(Number(m.cantidad)),
    unitCostBs: Number(historical(m).costBs),
    bcvRate: Number(historical(m).rate),
  }));

  const download = (format: "csv" | "json") => {
    if (!rows.length || pending) {
      alert("Complete los códigos, nombres, costos unitarios históricos y tasas BCV pendientes antes de exportar.");
      return;
    }
    const data = exportRows();
    const baseName = "POSVEN_Salidas_Inventario_" + from + "_" + to;
    let blob: Blob;
    let extension: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify({ format: "SICOVEN_INVENTORY_MOVEMENTS", version: 1, period: { from, to }, movements: data }, null, 2)], { type: "application/json;charset=utf-8" });
      extension = "json";
    } else {
      const columns = ["productCode", "productName", "date", "type", "concept", "documentRef", "quantity", "unitCostBs", "bcvRate"] as const;
      const quote = (value: unknown) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
      blob = new Blob(["\uFEFF" + [columns.join(","), ...data.map(row => columns.map(key => quote(row[key])).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
      extension = "csv";
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = baseName + "." + extension;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-4">
    <Card className="p-5 bg-white border-line shadow-sm rounded-xl space-y-4 no-print">
      <div>
        <h3 className="font-black text-sm uppercase text-ink">Resumen periódico de movimientos de salida</h3>
        <p className="text-xs text-ink/50 mt-1">Consulta de solo lectura del Kardex para preparar la importación de movimientos en SICOVEN.</p>
      </div>
      {loadError && <p className="text-sm font-bold text-red-700">{loadError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="form-group mb-0"><Label className="text-[10px] font-black uppercase">Desde</Label><Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="h-10 bg-white" /></div>
        <div className="form-group mb-0"><Label className="text-[10px] font-black uppercase">Hasta</Label><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-10 bg-white" /></div>
        <div className="form-group mb-0"><Label className="text-[10px] font-black uppercase">Categoría</Label><select className="form-select h-10 w-full" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{Array.from(new Set((source.productos || []).map(p => p.categoria).filter(Boolean))).sort().map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <div className="form-group mb-0"><Label className="text-[10px] font-black uppercase">Buscar</Label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, producto o referencia" className="h-10 bg-white" /></div>
      </div>
    </Card>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card className="p-4 bg-white border-line"><p className="text-[10px] uppercase font-black text-ink/40">Movimientos de salida</p><p className="text-2xl font-black text-ink">{rows.length}</p></Card>
      <Card className="p-4 bg-white border-line"><p className="text-[10px] uppercase font-black text-ink/40">Unidades de salida</p><p className="text-2xl font-black text-ink">{units.toLocaleString("es-VE")}</p></Card>
      <Card className="p-4 border border-amber-200 bg-amber-50"><p className="text-[10px] uppercase font-black text-ink/50">Datos históricos pendientes</p><p className="text-2xl font-black text-amber-700">{pending}</p><p className="text-[10px] text-ink/50">Código, costo unitario y/o tasa BCV</p></Card>
    </div>
    <Card className="overflow-hidden bg-white border-line shadow-sm rounded-xl">
      <div className="p-4 bg-ink text-white flex flex-wrap justify-between gap-2 items-center">
        <div><h4 className="font-black text-xs uppercase">Revisión previa de movimientos</h4><p className="text-[10px] text-white/60">Solo se aceptan snapshots históricos del movimiento; los datos ausentes requieren revisión manual.</p></div>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => download("csv")} disabled={loading || !!loadError || !rows.length || pending > 0} className="font-black uppercase text-[10px]"><Download className="w-4 h-4" /> CSV</Button><Button onClick={() => download("json")} disabled={loading || !!loadError || !rows.length || pending > 0} className="bg-brand-gold text-ink hover:bg-brand-gold-deep font-black uppercase text-[10px]"><FileSpreadsheet className="w-4 h-4" /> JSON</Button></div>
      </div>
      <div className="table-wrap"><Table><TableHeader><TableRow className="bg-surface-soft">
        <TableHead className="text-[10px] font-black uppercase">Fecha</TableHead><TableHead className="text-[10px] font-black uppercase">Código / Producto</TableHead><TableHead className="text-[10px] font-black uppercase">Concepto</TableHead><TableHead className="text-[10px] font-black uppercase text-right">Cantidad</TableHead><TableHead className="text-[10px] font-black uppercase">Referencia</TableHead><TableHead className="text-[10px] font-black uppercase">Costo unit. Bs.</TableHead><TableHead className="text-[10px] font-black uppercase">Tasa BCV</TableHead>
      </TableRow></TableHeader><TableBody>
        {rows.map(({ movement: m, product: p }) => <TableRow key={m.id} className="border-b border-line/30">
          <TableCell className="text-xs font-bold whitespace-nowrap">{m.fecha.slice(0, 10)}</TableCell>
          <TableCell className="min-w-48">{p?.codigo ? <><p className="text-xs font-black">{p.codigo}</p><p className="text-[10px] text-ink/50">{p.nombre}</p></> : <div className="space-y-1"><Input value={historical(m).productCode} onChange={e => setValue(m.id, "productCode", e.target.value)} placeholder="Código SICOVEN" className="h-8 min-w-28 bg-white" /><Input value={historical(m).productName} onChange={e => setValue(m.id, "productName", e.target.value)} placeholder="Nombre del producto" className="h-8 min-w-28 bg-white" /></div>}</TableCell>
          <TableCell><p className="text-[10px] font-black uppercase">SALIDA</p><p className="text-[10px] text-ink/50">{m.tipo === "venta" ? "VENTA" : m.tipo === "consumo" || m.tipo === "colaboracion" ? "AUTOCONSUMO" : "OTRA SALIDA"}</p></TableCell>
          <TableCell className="text-right font-black text-status-danger">{Math.abs(m.cantidad)}</TableCell>
          <TableCell className="text-[10px] min-w-36">{m.referencia || m.id}</TableCell>
          <TableCell className="min-w-36"><Input type="number" min="0" step="0.0001" value={historical(m).costBs} onChange={e => setValue(m.id, "costBs", e.target.value)} placeholder="Requerido" className="h-9 min-w-28 bg-white text-right" /></TableCell>
          <TableCell className="min-w-32"><Input type="number" min="0" step="0.0001" value={historical(m).rate} onChange={e => setValue(m.id, "rate", e.target.value)} placeholder="Requerida" className="h-9 min-w-24 bg-white text-right" /></TableCell>
        </TableRow>)}
        {loading && <TableRow><TableCell colSpan={7} className="py-16 text-center font-bold">Consultando historial completo en Turso…</TableCell></TableRow>}{!loading && !loadError && !rows.length && <TableRow><TableCell colSpan={7} className="py-16 text-center text-ink/30 font-black uppercase">No hay salidas para los filtros seleccionados</TableCell></TableRow>}
      </TableBody></Table></div>
      <div className="p-4 border-t border-line text-xs"><span className="text-ink/50">Costo total revisado: <b className="text-ink">{rows.reduce((sum, row) => sum + Math.abs(row.movement.cantidad) * (Number(historical(row.movement).costBs) || 0), 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.</b></span><p className={pending ? "text-amber-700 font-bold" : "text-status-success font-bold"}>{pending ? "Complete los datos históricos pendientes para habilitar la exportación." : "Revisión completa: exportación habilitada."}</p></div>
    </Card>
    <p className="text-[10px] text-ink/40">Se exportan el código y la descripción del producto, no el ID interno de POSVEN, porque SICOVEN mantiene identificadores propios.</p>
  </div>;
}
