"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

type ArqueoMethod = {
  metodo: string;
  moneda?: string;
  ventasBS?: number;
  ventasUSD?: number;
  cobrosBS?: number;
  cobrosUSD?: number;
  devBS?: number;
  devUSD?: number;
  movPlusBS?: number;
  movPlusUSD?: number;
  movMinusBS?: number;
  movMinusUSD?: number;
};

type Props = {
  open: boolean;
  report: any;
  onCancel: () => void;
  onConfirm: (real: Record<string, string>, diff: { bs: number; usd: number }) => void;
};

const money = (value: number, currency: "BS" | "USD") =>
  currency === "BS"
    ? "Bs. " + Number(value || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "$" + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const label = (method: string) => {
  const map: Record<string, string> = {
    efectivo_bs: "Efectivo Bs.",
    efectivo_usd: "Efectivo USD",
    zelle: "Zelle",
    pagomovil: "Pago Móvil",
    pago_movil: "Pago Móvil",
    biopago: "Biopago",
    transferencia: "Transferencia",
    transferencia_bs: "Transferencia Bs.",
    transferencia_usd: "Transferencia USD",
    tarjeta: "Tarjeta",
    credito: "Crédito",
  };
  return map[method] || method;
};

export default function CashZArqueoModal({ open, report, onCancel, onConfirm }: Props) {
  const [real, setReal] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    if (!report) return [];
    const source: ArqueoMethod[] = Array.isArray(report.metodosArqueo) ? report.metodosArqueo : [];
    const methods = new Map<string, ArqueoMethod>();
    source.forEach((r) => methods.set(String(r.metodo), r));

    // Siempre presentamos los medios principales, aunque tengan cero movimiento.
    [
      "efectivo_bs",
      "efectivo_usd",
      "zelle",
      "pagomovil",
      "biopago",
      "transferencia_bs",
      "transferencia_usd",
      "tarjeta",
      "credito",
    ].forEach((m) => {
      if (!methods.has(m)) methods.set(m, { metodo: m });
    });

    return Array.from(methods.values()).map((r) => {
      const method = String(r.metodo);
      const currency: "BS" | "USD" =
        ["efectivo_usd", "zelle", "transferencia_usd"].includes(method) ? "USD" : "BS";

      const opening =
        method === "efectivo_bs"
          ? Number(report.fondoAperturaBS || 0)
          : method === "efectivo_usd"
            ? Number(report.fondoAperturaUSD || 0)
            : 0;

      const sales = currency === "BS" ? Number(r.ventasBS || 0) : Number(r.ventasUSD || 0);
      const cxc = currency === "BS" ? Number(r.cobrosBS || 0) : Number(r.cobrosUSD || 0);
      const dev = currency === "BS" ? Number(r.devBS || 0) : Number(r.devUSD || 0);
      const plus = currency === "BS" ? Number(r.movPlusBS || 0) : Number(r.movPlusUSD || 0);
      const minus = currency === "BS" ? Number(r.movMinusBS || 0) : Number(r.movMinusUSD || 0);

      // Igual que tienda-pos: el sistema se calcula por método y moneda,
      // sin convertir medios no físicos a efectivo.
      const system = opening + sales + cxc - dev + plus - minus;

      return { method, currency, opening, sales, cxc, dev, plus, minus, system: Number(system.toFixed(2)) };
    });
  }, [report]);

  const diff = useMemo(() => {
    let bs = 0;
    let usd = 0;
    for (const row of rows) {
      const raw = String(real[row.method] ?? "").trim().replace(",", ".");
      if (!raw) continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount)) continue;
      if (row.currency === "BS") bs += amount - row.system;
      else usd += amount - row.system;
    }
    return { bs: Number(bs.toFixed(2)), usd: Number(usd.toFixed(2)) };
  }, [rows, real]);

  if (!open || !report) return null;

  const reconciled = Math.abs(diff.bs) < 0.01 && Math.abs(diff.usd) < 0.01;
  const positive = diff.bs > 0.01 || diff.usd > 0.01;
  const result = reconciled ? "ARQUEO CONCILIADO" : positive ? "SOBRANTE" : "FALTANTE";

  return (
    <div className="fixed inset-0 z-[220] bg-black/60 flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-[1500px] max-h-[94vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 bg-ink text-white flex items-center justify-between">
          <div>
            <h3 className="text-base font-black uppercase italic">Arqueo previo al Corte Z</h3>
            <p className="text-[9px] text-white/60 font-bold uppercase mt-1">
              {report.terminalName || "Caja"} · Z-{String(report.numeroZ || 0).padStart(6, "0")}
            </p>
          </div>
          <button onClick={onCancel} className="p-2 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-auto">
          <table className="min-w-[1250px] w-full text-xs border-collapse">
            <thead className="bg-surface-soft text-ink">
              <tr>
                {[
                  "Método de pago",
                  "Fondo Inicial Bs.",
                  "Fondo Inicial USD",
                  "Ventas",
                  "CxC (cobro)",
                  "Dev/Anu.",
                  "Mov. Caja (+)",
                  "Mov. Caja (-)",
                  "Total Monto Sistema",
                  "Monto Real",
                  "DIF. (+/-)",
                ].map((h) => <th key={h} className="p-2 border border-line text-left font-black uppercase">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const raw = String(real[row.method] ?? "");
                const n = raw.trim() === "" ? null : Number(raw.replace(",", "."));
                const rowDiff = n === null || !Number.isFinite(n) ? null : Number((n - row.system).toFixed(2));
                return (
                  <tr key={row.method}>
                    <td className="p-2 border border-line font-black">{label(row.method)}</td>
                    <td className="p-2 border border-line text-right">{money(row.method === "efectivo_bs" ? row.opening : 0, "BS")}</td>
                    <td className="p-2 border border-line text-right">{money(row.method === "efectivo_usd" ? row.opening : 0, "USD")}</td>
                    <td className="p-2 border border-line text-right">{money(row.sales, row.currency)}</td>
                    <td className="p-2 border border-line text-right">{money(row.cxc, row.currency)}</td>
                    <td className="p-2 border border-line text-right">{money(row.dev, row.currency)}</td>
                    <td className="p-2 border border-line text-right">{money(row.plus, row.currency)}</td>
                    <td className="p-2 border border-line text-right">{money(row.minus, row.currency)}</td>
                    <td className="p-2 border border-line text-right font-black">{money(row.system, row.currency)}</td>
                    <td className="p-1 border border-line">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => setReal((prev) => ({ ...prev, [row.method]: e.target.value }))}
                        placeholder={row.currency === "BS" ? "Bs." : "USD"}
                        className="w-32 px-2 py-1.5 border border-line rounded-lg text-right font-bold"
                      />
                    </td>
                    <td className={`p-2 border border-line text-right font-black ${rowDiff === null ? "text-ink/30" : rowDiff > 0.005 ? "text-status-success" : rowDiff < -0.005 ? "text-status-danger" : "text-ink"}`}>
                      {rowDiff === null ? "—" : money(rowDiff, row.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={`mt-4 rounded-xl border p-4 ${reconciled ? "bg-status-success/10 border-status-success/20" : "bg-surface-soft border-line"}`}>
            <div className="flex items-center gap-2 font-black text-sm">
              {reconciled ? <CheckCircle2 className="w-5 h-5 text-status-success" /> : <AlertTriangle className="w-5 h-5 text-brand-gold-deep" />}
              {result}
            </div>
            <div className="text-xs mt-1">
              Diferencia Bs.: <b>{money(diff.bs, "BS")}</b> · Diferencia USD: <b>{money(diff.usd, "USD")}</b>
            </div>
            <div className="text-[10px] text-ink/50 mt-1">
              El monto real se introduce por cada medio de pago. El sistema no convierte pagos electrónicos a efectivo.
            </div>
          </div>
        </div>

        <div className="p-4 bg-surface-soft border-t border-line flex justify-end gap-2">
          <button onClick={onCancel} className="px-5 h-10 rounded-xl border border-line text-ink font-black uppercase text-[10px]">Cancelar</button>
          <button
            onClick={() => onConfirm(real, diff)}
            className="px-5 h-10 rounded-xl bg-status-danger text-white font-black uppercase text-[10px] shadow-md"
          >
            Guardar y ejecutar Z
          </button>
        </div>
      </div>
    </div>
  );
}