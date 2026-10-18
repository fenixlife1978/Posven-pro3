'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange, className }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 py-3 bg-white border-t border-line", className)}>
      <span className="text-[10px] font-black uppercase text-ink/40">
        Mostrando {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 px-3 rounded-lg border border-line text-[10px] font-black uppercase flex items-center gap-1 text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-soft transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>
        <span className="text-[10px] font-black uppercase text-ink/60 min-w-[70px] text-center">
          Pág. {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 px-3 rounded-lg border border-line text-[10px] font-black uppercase flex items-center gap-1 text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-soft transition-colors"
        >
          Siguiente <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
