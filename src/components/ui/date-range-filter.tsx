'use client';

import React from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DateRange {
  desde: string;
  hasta: string;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (v: DateRange) => void;
  className?: string;
}

function hoyVzla(): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 8) + '01';
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const hoy = hoyVzla();
  const ayer = addDays(hoy, -1);
  const inicioMes = startOfMonth(hoy);

  const presets = [
    { label: 'Hoy', range: { desde: hoy, hasta: hoy }, active: value.desde === hoy && value.hasta === hoy },
    { label: 'Ayer', range: { desde: ayer, hasta: ayer }, active: value.desde === ayer && value.hasta === ayer },
    { label: 'Este Mes', range: { desde: inicioMes, hasta: hoy }, active: value.desde === inicioMes && value.hasta === hoy },
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {presets.map(p => (
        <button
          key={p.label}
          type="button"
          onClick={() => onChange(p.range)}
          className={cn(
            'px-4 py-2 rounded-md text-[10px] font-black uppercase transition-all border',
            p.active
              ? 'bg-ink text-white border-ink'
              : 'bg-white text-ink/40 border-line hover:text-ink'
          )}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <CalendarDays className="w-4 h-4 text-ink/30" />
        <input
          type="date"
          className="form-input h-8 text-xs font-bold"
          value={value.desde}
          onChange={e => onChange({ ...value, desde: e.target.value })}
        />
        <span className="text-ink/30 text-xs font-black">→</span>
        <input
          type="date"
          className="form-input h-8 text-xs font-bold"
          value={value.hasta}
          onChange={e => onChange({ ...value, hasta: e.target.value })}
        />
      </div>
    </div>
  );
}
