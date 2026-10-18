"use client";

import React from 'react';
import { AppState } from '@/lib/types';
import { Utils } from '@/lib/db-store';
import { 
  Banknote, 
  Receipt, 
  Users, 
  Warehouse, 
  ArrowUpRight, 
  TrendingUp, 
  Zap, 
  FileDown, 
  Sparkles,
  MoreHorizontal,
  ChevronRight
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Area, 
  AreaChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export default function DashboardModule({ state }: { state: AppState }) {
  const hoy = Utils.hoy();
  const ventasHoy = state.ventas.filter(v => v.fecha.startsWith(hoy));
  const totalVentasHoyUSD = ventasHoy.reduce((s, v) => s + v.totalUSD, 0);
  const ticketPromedio = ventasHoy.length > 0 ? totalVentasHoyUSD / ventasHoy.length : 0;
  
  const productosActivos = state.productos.filter(p => p.activo);
  const stockCritico = productosActivos.filter(p => p.stock <= p.stockMinimo).length;
  const clientesActivos = state.clientes.length;

  const totalVentasBs = ventasHoy.reduce((s, v) => s + v.totalBS, 0);

  // Mapeo de colores por método de pago
  const methodColors: Record<string, string> = {
    efectivo_usd: '#C8952E', // Dorado
    efectivo_bs: '#141414',  // Negro
    punto_venta: '#2563EB',  // Azul
    tarjeta: '#2563EB',      // Azul
    biopago: '#7C3AED',      // Púrpura
    pagomovil: '#F59E0B',    // Ámbar
    zelle: '#2F8F3F',        // Verde
    credito: '#DC2626',      // Rojo
    mixto: '#6B7280',        // Gris
    nota_credito: '#06B6D4', // Cian
    otros: '#94A3B8'         // Pizarra
  };

  // Derivación de métodos de pago reales
  const metodosDataMap: Record<string, number> = {};
  ventasHoy.forEach(v => {
    const m = v.metodoPago || 'otros';
    metodosDataMap[m] = (metodosDataMap[m] || 0) + v.totalUSD;
  });

  const paymentMethods = Object.entries(metodosDataMap).map(([label, val]) => ({
    label: Utils.metodoLabel(label),
    ops: ventasHoy.filter(v => v.metodoPago === label).length,
    pct: totalVentasHoyUSD > 0 ? Math.round((val / totalVentasHoyUSD) * 100) : 0,
    color: methodColors[label] || '#94A3B8'
  }));

  // Gráfico de los últimos 7 días
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('es-VE', { weekday: 'short' });
    const total = state.ventas.filter(v => v.fecha.startsWith(iso)).reduce((s, v) => s + v.totalUSD, 0);
    return { name: label, ventas: total * state.tasa, usd: total };
  });

  // Top 5 Productos Reales (Agrupados por nombre para evitar duplicidad visual)
  const productPerformance: Record<string, { n: string, c: string, u: number, t: number }> = {};
  state.ventas.forEach(v => {
    v.items.forEach(it => {
      const key = it.nombre.toUpperCase().trim();
      if (!productPerformance[key]) {
        // Buscar categoría del producto en el catálogo actual si existe
        const catalogProd = state.productos.find(p => p.id === it.productoId);
        productPerformance[key] = { n: it.nombre, c: catalogProd?.categoria || 'General', u: 0, t: 0 };
      }
      productPerformance[key].u += it.cantidad;
      productPerformance[key].t += it.subtotalUSD;
    });
  });

  const topProductos = Object.values(productPerformance)
    .sort((a, b) => b.u - a.u)
    .slice(0, 5)
    .map(p => ({
      initials: p.n.substring(0, 2).toUpperCase(),
      nombre: p.n,
      categoria: p.c,
      unidades: p.u,
      total: p.t * state.tasa,
      progress: 100 // Visual simple
    }));

  const userName = "Usuario";

  return (
    <div className="space-y-8 max-w-full overflow-hidden animate-in fade-in duration-700">
      
      {/* 1. HERO BLOCK */}
      <section className="bg-[#141414] rounded-[20px] p-8 relative overflow-hidden grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-center border border-white/5">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#C8952E]/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
        
        <div className="relative z-10 space-y-5">
          <div className="inline-flex items-center gap-2 bg-[#C8952E]/15 border border-[#C8952E]/30 text-[#E7B857] px-3.5 py-1.5 rounded-full text-[0.7rem] font-bold uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" />
            Panel Administrativo Real
          </div>
          <h1 className="font-display text-[1.75rem] md:text-[2.2rem] font-[800] text-white leading-[1.2]">
            Resumen Operativo de<br />
            <span className="text-brand-gold">{state.empresa.nombre}</span>
          </h1>
          <p className="text-[#BDB6A4] text-[0.95rem] max-w-[48ch] font-medium">
            Se registran {ventasHoy.length} transacciones el día de hoy. Existen {stockCritico} productos con niveles de inventario por debajo del mínimo configurado.
          </p>
          <div className="flex flex-wrap gap-3.5 pt-2">
            <button className="h-12 px-6 rounded-full bg-brand-gold text-ink font-bold flex items-center gap-2.5 shadow-lg shadow-brand-gold/20 hover:bg-brand-gold-deep hover:text-white transition-all">
              <Zap className="w-4 h-4" />
              Gestión de Inventario
            </button>
            <button onClick={() => window.print()} className="h-12 px-6 rounded-full bg-white/5 border border-white/20 text-white font-bold flex items-center gap-2.5 hover:bg-white/10 transition-all">
              <FileDown className="w-4 h-4" />
              Imprimir Pantalla
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 relative z-10 lg:pl-4 border-l border-white/5">
          <div className="bg-white/5 border border-white/10 rounded-[18px] p-4 space-y-1.5">
            <div className="text-[0.66rem] font-bold text-[#9A9384] uppercase tracking-widest">Ventas Hoy</div>
            <div className="font-display text-[1.25rem] font-black text-white">Bs {totalVentasBs.toLocaleString()}</div>
            <div className="text-[0.7rem] font-bold text-brand-gold opacity-80">{Utils.fmtUSD(totalVentasHoyUSD)}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[18px] p-4 space-y-1.5">
            <div className="text-[0.66rem] font-bold text-[#9A9384] uppercase tracking-widest">Ticket Prom.</div>
            <div className="font-display text-[1.25rem] font-black text-white">{Utils.fmtUSD(ticketPromedio)}</div>
            <div className="text-[0.7rem] font-bold text-white/40 uppercase">{ventasHoy.length} OPS</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[18px] p-4 space-y-1.5 sm:col-span-1 col-span-2">
            <div className="text-[0.66rem] font-bold text-[#9A9384] uppercase tracking-widest">Alerta Stock</div>
            <div className={`font-display text-[1.25rem] font-black ${stockCritico > 0 ? 'text-status-danger' : 'text-status-success'}`}>{stockCritico} ITEMS</div>
            <div className="text-[0.7rem] font-bold text-white/40 uppercase">REPOSICIÓN PEND.</div>
          </div>
        </div>
      </section>

      {/* 2. KPI CARDS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white border border-line rounded-[20px] p-6 shadow-sm-card group hover:shadow-card transition-all">
          <div className="flex justify-between items-start">
            <div className="w-11 h-11 rounded-[12px] flex items-center justify-center bg-brand-gold-soft text-brand-gold-deep"><Banknote className="w-5 h-5" /></div>
          </div>
          <div className="mt-5">
            <div className="text-[0.74rem] font-bold text-ink-subtle uppercase tracking-wider">Caja Hoy (USD)</div>
            <div className="font-display text-[1.7rem] font-[800] text-ink mt-0.5">{Utils.fmtUSD(totalVentasHoyUSD)}</div>
          </div>
          <div className="mt-2.5 pt-3 border-t border-line text-[0.74rem] font-medium text-ink-subtle/80 uppercase">Bolívares: {Utils.fmtBS(totalVentasBs)}</div>
        </div>

        <div className="bg-white border border-line rounded-[20px] p-6 shadow-sm-card group hover:shadow-card transition-all">
          <div className="flex justify-between items-start">
            <div className="w-11 h-11 rounded-[12px] flex items-center justify-center bg-status-success-soft text-status-success"><Receipt className="w-5 h-5" /></div>
          </div>
          <div className="mt-5">
            <div className="text-[0.74rem] font-bold text-ink-subtle uppercase tracking-wider">Total Facturado</div>
            <div className="font-display text-[1.7rem] font-[800] text-ink mt-0.5">{state.ventas.length}</div>
          </div>
          <div className="mt-2.5 pt-3 border-t border-line text-[0.74rem] font-medium text-ink-subtle/80 uppercase">Histórico del Sistema</div>
        </div>

        <div className="bg-white border border-line rounded-[20px] p-6 shadow-sm-card group hover:shadow-card transition-all">
          <div className="flex justify-between items-start">
            <div className="w-11 h-11 rounded-[12px] flex items-center justify-center bg-status-info-soft text-status-info"><Users className="w-5 h-5" /></div>
          </div>
          <div className="mt-5">
            <div className="text-[0.74rem] font-bold text-ink-subtle uppercase tracking-wider">Clientes</div>
            <div className="font-display text-[1.7rem] font-[800] text-ink mt-0.5">{clientesActivos}</div>
          </div>
          <div className="mt-2.5 pt-3 border-t border-line text-[0.74rem] font-medium text-ink-subtle/80 uppercase">Directorio Registrado</div>
        </div>

        <div className="bg-white border border-line rounded-[20px] p-6 shadow-sm-card group hover:shadow-card transition-all">
          <div className="flex justify-between items-start">
            <div className="w-11 h-11 rounded-[12px] flex items-center justify-center bg-[#EFE7FB] text-[#7C3AED]"><Warehouse className="w-5 h-5" /></div>
          </div>
          <div className="mt-5">
            <div className="text-[0.74rem] font-bold text-ink-subtle uppercase tracking-wider">Productos</div>
            <div className="font-display text-[1.7rem] font-[800] text-ink mt-0.5">{productosActivos.length}</div>
          </div>
          <div className="mt-2.5 pt-3 border-t border-line text-[0.74rem] font-medium text-ink-subtle/80 uppercase">Catálogo Activo</div>
        </div>
      </section>

      {/* 3. CHARTS + TOP PRODUCTS */}
      <section className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-7">
        <div className="bg-white border border-line rounded-[20px] shadow-sm-card flex flex-col h-[500px]">
          <div className="p-6 border-b border-line flex justify-between items-center">
            <div>
              <h3 className="font-display font-[800] text-lg text-ink leading-tight">Actividad de Ventas (7 Días)</h3>
              <p className="text-[0.7rem] text-ink-subtle uppercase font-bold tracking-widest mt-0.5">Basado en equivalentes en Bolívares</p>
            </div>
          </div>
          <div className="flex-1 p-6 pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last7Days}>
                <defs>
                  <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C8952E" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#C8952E" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#EFEBE0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#8A8A8A' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#8A8A8A' }} tickFormatter={(val) => `Bs ${val}`} />
                <Tooltip contentStyle={{ backgroundColor: '#141414', borderRadius: '12px', border: 'none', color: '#fff' }} />
                <Area type="monotone" dataKey="ventas" stroke="#C8952E" strokeWidth={3} fillOpacity={1} fill="url(#colorVentas)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-line rounded-[20px] shadow-sm-card flex flex-col">
          <div className="p-6 border-b border-line">
            <h3 className="font-display font-[800] text-lg text-ink leading-tight">Top Productos Vendidos</h3>
            <p className="text-[0.7rem] text-ink-subtle uppercase font-bold tracking-widest mt-0.5">Ranking Histórico de Salida</p>
          </div>
          <div className="flex-1 p-6 space-y-6">
            {topProductos.map((prod, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-4 items-center">
                <div className="w-[42px] h-[42px] rounded-[10px] bg-surface-soft border border-line flex items-center justify-center font-black text-ink-subtle text-sm">{prod.initials}</div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex justify-between items-end gap-2">
                    <div className="text-[0.88rem] font-[700] text-ink truncate uppercase">{prod.nombre}</div>
                    <div className="text-[0.88rem] font-[800] text-ink whitespace-nowrap">Bs {prod.total.toLocaleString()}</div>
                  </div>
                  <div className="flex justify-between items-center text-[0.72rem] font-bold text-ink-subtle mb-1.5">
                    <span className="px-2 py-0.5 bg-surface-soft rounded text-[0.65rem] uppercase">{prod.categoria}</span>
                    <span>· {prod.unidades} unds.</span>
                  </div>
                </div>
              </div>
            ))}
            {topProductos.length === 0 && <div className="text-center py-20 text-ink/20 font-black uppercase italic text-xs">Sin datos de ventas</div>}
          </div>
        </div>
      </section>

      {/* 4. PAYMENT METHODS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        <div className="bg-white border border-line rounded-[20px] shadow-sm-card flex flex-col p-6">
           <h3 className="font-display font-[800] text-lg text-ink leading-tight mb-6">Distribución Métodos de Pago (Hoy)</h3>
           <div className="flex flex-col sm:flex-row items-center gap-8">
             <div className="relative w-[180px] h-[180px]">
               <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                   <Pie data={paymentMethods} cx="50%" cy="50%" innerRadius={65} outerRadius={85} paddingAngle={3} dataKey="pct">
                     {paymentMethods.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                   </Pie>
                 </PieChart>
               </ResponsiveContainer>
               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                 <div className="font-display text-[1.2rem] font-black text-ink leading-none">{Utils.fmtUSD(totalVentasHoyUSD)}</div>
               </div>
             </div>
             <div className="flex-1 w-full space-y-4">
               {paymentMethods.map((method, i) => (
                 <div key={i} className="flex items-center gap-3">
                   <div className="w-3 h-3 rounded-full" style={{ backgroundColor: method.color }} />
                   <div className="flex-1">
                     <div className="flex justify-between items-center text-[0.78rem] font-bold">
                       <span className="text-ink-muted">{method.label}</span>
                       <span className="text-ink">{method.pct}%</span>
                     </div>
                   </div>
                 </div>
               ))}
               {paymentMethods.length === 0 && <p className="text-xs text-ink/30 italic">Sin operaciones registradas hoy</p>}
             </div>
           </div>
        </div>
        
        <div className="bg-white border border-line rounded-[20px] shadow-sm-card p-6 flex flex-col items-center justify-center text-center">
            <Sparkles className="w-12 h-12 text-brand-gold opacity-20 mb-4" />
            <h3 className="font-display font-black text-ink uppercase text-sm mb-2">Sistema PosVEN Pro Cloud</h3>
            <p className="text-xs font-medium text-ink-subtle max-w-xs uppercase tracking-widest leading-loose">Información sincronizada en tiempo real con Firebase RTDB para todos los terminales de venta.</p>
        </div>
      </section>

    </div>
  );
}
