"use client";

import { useCallback, useEffect, useState } from 'react';

type Status = {
  demo: boolean;
  limit: number;
  used: { sales: number; purchases: number; items: number };
  remaining: { sales: number; purchases: number; items: number };
  locked: boolean;
  exhausted?: string[];
};

export default function DemoNotice() {
  const isDemo = process.env.NEXT_PUBLIC_POSVEN_DEMO_BUILD === '1';
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(async () => {
    if (!isDemo) return;
    try {
      const response = await fetch('/api/demo/status', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      if (data.demo) setStatus(data as Status);
    } catch {}
  }, [isDemo]);

  useEffect(() => {
    if (!isDemo) return;
    void refresh();
    const handle = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(handle);
  }, [isDemo, refresh]);

  if (!isDemo) return null;
  const locked = !!status?.locked;
  return <>
    <div className="fixed top-0 inset-x-0 z-[9998] bg-[#082b52] text-white border-b-2 border-yellow-400 px-3 py-2 text-center text-xs sm:text-sm font-bold shadow-lg">
      DEMO DE EVALUACIÓN · Datos ficticios · Cupos: ventas {status?.used.sales ?? 0}/10, compras {status?.used.purchases ?? 0}/10, nuevos ítems {status?.used.items ?? 0}/10 · <span className="text-yellow-300">Adquiere POSVEN-PRO completo para uso sin límites</span>
    </div>
    {locked && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/95 p-5 text-center text-white">
      <div className="w-full max-w-xl rounded-2xl border-2 border-yellow-400 bg-[#082b52] p-7 shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-yellow-400 text-3xl font-black text-yellow-300">!</div>
        <p className="mb-2 text-sm font-black uppercase tracking-[0.25em] text-yellow-300">POSVEN-PRO · DEMO</p>
        <h1 className="mb-3 text-2xl sm:text-3xl font-black">Has agotado el cupo de demostración</h1>
        <p className="mb-5 text-sm leading-6 text-slate-100">La evaluación gratuita permite hasta 10 ventas, 10 compras y 10 nuevos ítems. Para seguir trabajando sin interrupciones, adquiere la versión completa de POSVEN-PRO.</p>
        <p className="mb-6 rounded-lg bg-white/10 p-3 text-xs text-slate-200">Los datos de esta edición son ficticios y solo sirven para evaluación. No utilices esta DEMO para operaciones comerciales reales.</p>
        <button type="button" onClick={() => window.location.href = 'mailto:ventas@posven.pro?subject=Adquisici%C3%B3n%20POSVEN-PRO'} className="rounded-lg bg-yellow-400 px-6 py-3 font-black text-[#082b52] hover:bg-yellow-300">Quiero adquirir POSVEN-PRO</button>
      </div>
    </div>}
  </>;
}
