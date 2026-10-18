"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, DollarSign, CreditCard, Banknote, Smartphone, Fingerprint, Plane, Plus, Trash2, Calculator, ArrowRightLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  formatBs, 
  formatUsd, 
  formatUsdNumber,
  toCentsBs,
  toCentsUsd,
  fromCentsBs,
  fromCentsUsd,
} from '@/lib/currency-formatter';

interface PaymentItem {
  id: string;
  method: string;
  amount: number;
  usdAmount?: number;
  amountCents: number;
  usdAmountCents?: number;
}

interface FloatingPaymentModalProps {
  total: number;
  totalCents: number;
  exchangeRate: number;
  onClose: () => void;
  allowPartial?: boolean;
  onConfirm: (data: { 
    payments: PaymentItem[]; 
    totalPaid: number; 
    totalPaidCents: number;
    change: number; 
    changeCents: number;
    method: string; 
    ajusteRedondeoBs?: number;
    ajusteRedondeoBsCents?: number;
  }) => void;
}

const methods = [
  { id: 'efectivo_bs', label: 'EFECTIVO Bs', icon: Banknote, currency: 'Bs' },
  { id: 'efectivo_usd', label: 'EFECTIVO USD', icon: DollarSign, currency: 'USD' },
  { id: 'tarjeta', label: 'TARJETA', icon: CreditCard, currency: 'Bs' },
  { id: 'biopago', label: 'BIOPAGO', icon: Fingerprint, currency: 'Bs' },
  { id: 'pagomovil', label: 'PAGO MÓVIL', icon: Smartphone, currency: 'Bs' },
  { id: 'zelle', label: 'ZELLE', icon: Plane, currency: 'USD' },
];

export default function FloatingPaymentModal({ 
  total, 
  totalCents, 
  exchangeRate, 
  onClose, 
  allowPartial = false,
  onConfirm 
}: FloatingPaymentModalProps) {
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [currentMethod, setCurrentMethod] = useState('efectivo_bs');
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [showConverter, setShowConverter] = useState(false);
  const [calcUSD, setCalcUSD] = useState('');
  const [calcBS, setCalcBS] = useState('');
  const [lastEdited, setLastEdited] = useState<'USD' | 'BS' | null>(null);

  const currentMethodObj = methods.find(m => m.id === currentMethod);
  const isUsd = currentMethodObj?.currency === 'USD';

  const totalPaidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const totalPaid = fromCentsBs(totalPaidCents);
  
  const totalUsdCents = Math.round((totalCents * 100) / Math.round(exchangeRate * 100));
  
  const totalPaidUsdCents = payments.reduce((sum, p) => {
    if (p.usdAmountCents) return sum + p.usdAmountCents;
    return sum + Math.round((p.amountCents * 100) / Math.round(exchangeRate * 100));
  }, 0);

  const isPaidByUsd = totalPaidUsdCents >= (totalUsdCents - 1);
  const isFullyPaid = isPaidByUsd || (totalPaidCents >= totalCents - 1);
  const canConfirm = isFullyPaid || (allowPartial && totalPaidCents > 0);
  const remainingCents = isFullyPaid ? 0 : Math.max(0, totalCents - totalPaidCents);
  const remaining = fromCentsBs(remainingCents);
  
  let changeCents = Math.max(0, totalPaidCents - totalCents);
  if (isPaidByUsd && Math.abs(totalPaidUsdCents - totalUsdCents) <= 1 && changeCents <= 5) {
    changeCents = 0;
  }
  
  const change = fromCentsBs(changeCents);
  const ajusteRedondeoBsCents = (isPaidByUsd && totalPaidCents < totalCents) ? (totalCents - totalPaidCents) : 0;
  const ajusteRedondeoBs = fromCentsBs(ajusteRedondeoBsCents);
  const displayedTotalPaidBsCents = (isPaidByUsd && (ajusteRedondeoBsCents > 0 || (totalPaidCents > totalCents && changeCents === 0))) ? totalCents : totalPaidCents;
  const displayedTotalPaidBs = fromCentsBs(displayedTotalPaidBsCents);

  const addPayment = (amountToUse?: string, forceMethod?: string) => {
    const valueStr = amountToUse || inputValue;
    const methodToUse = forceMethod || currentMethod;
    const methodObj = methods.find(m => m.id === methodToUse);
    const useUsd = methodObj?.currency === 'USD';

    let rawAmount = parseFloat(valueStr);
    if (isNaN(rawAmount) || rawAmount <= 0) return;

    if (useUsd) {
      const usdAmount = rawAmount;
      const usdAmountCents = toCentsUsd(usdAmount);
      const bsAmountCents = Math.round((usdAmountCents * Math.round(exchangeRate * 100)) / 100);
      const bsAmount = fromCentsBs(bsAmountCents);
      setPayments([...payments, {
        id: crypto.randomUUID(),
        method: methodToUse,
        amount: bsAmount,
        usdAmount: usdAmount,
        amountCents: bsAmountCents,
        usdAmountCents: usdAmountCents,
      }]);
    } else {
      const bsAmount = rawAmount;
      const bsAmountCents = toCentsBs(bsAmount);
      setPayments([...payments, {
        id: crypto.randomUUID(),
        method: methodToUse,
        amount: bsAmount,
        amountCents: bsAmountCents,
      }]);
    }
    setInputValue('');
    if (!amountToUse) inputRef.current?.focus();
  };

  const removePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id));
  };

  const setExactAmount = () => {
    const currentRemainingCents = Math.max(0, totalCents - totalPaidCents);
    if (currentRemainingCents <= 0) return;
    
    let amountToAdd = fromCentsBs(currentRemainingCents);
    if (isUsd) {
      amountToAdd = payments.length === 0 
        ? fromCentsUsd(totalUsdCents) 
        : fromCentsUsd(Math.round((currentRemainingCents * 100) / Math.round(exchangeRate * 100)));
    }
    setInputValue(amountToAdd.toFixed(2));
  };

  const confirmPayment = useCallback(() => {
    if (!canConfirm) return;
    setIsProcessing(true);
    const mainPayment = payments[0] || { method: 'efectivo_bs' };
    
    let finalChangeCents = Math.max(0, totalPaidCents - totalCents);
    if (isPaidByUsd && Math.abs(totalPaidUsdCents - totalUsdCents) <= 1 && finalChangeCents <= 5) {
      finalChangeCents = 0;
    }
    
    onConfirm({ 
      payments, 
      totalPaid: fromCentsBs(totalPaidCents),
      totalPaidCents: totalPaidCents,
      change: fromCentsBs(finalChangeCents),
      changeCents: finalChangeCents,
      method: mainPayment.method,
      ajusteRedondeoBs,
      ajusteRedondeoBsCents,
    });
    setIsProcessing(false);
  }, [payments, totalPaidCents, totalCents, canConfirm, isPaidByUsd, totalPaidUsdCents, totalUsdCents, ajusteRedondeoBs, ajusteRedondeoBsCents, onConfirm]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        if (canConfirm) confirmPayment();
      }
      if (e.key === 'Enter' && document.activeElement === inputRef.current) {
        e.preventDefault();
        addPayment();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canConfirm, confirmPayment, addPayment, onClose]);

  useEffect(() => { if (!showConverter) inputRef.current?.focus(); }, [showConverter]);

  return (
    <div
      className="fixed z-[200] bg-white rounded-2xl shadow-2xl w-[480px] max-w-[95vw] border border-gray-200 overflow-hidden"
      style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', position: 'fixed' }}
    >
      <div className="bg-black p-2.5 text-white flex justify-between items-center select-none">
        <div className="flex items-center gap-2">
          <Calculator size={16} className="text-brand-gold" />
          <h3 className="font-black text-[12px] uppercase tracking-tighter">Procesar Pago</h3>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="p-3.5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-soft p-3 rounded-xl text-center border border-line shadow-inner">
            <span className="text-[9px] font-black text-ink/40 uppercase tracking-widest block mb-0.5">Total Factura</span>
            <p className="text-2xl font-black text-ink">{formatBs(total)}</p>
            <p className="text-[10px] font-bold text-ink/40">≈ {formatUsd(total / exchangeRate)}</p>
          </div>
          <div className="bg-status-success-soft/20 p-3 rounded-xl text-center border border-status-success/20">
            <span className="text-[9px] font-black text-status-success uppercase tracking-widest block mb-0.5">Abonado Real</span>
            <p className="text-2xl font-black text-status-success">{formatBs(displayedTotalPaidBs)}</p>
            {totalPaidUsdCents > 0 && <p className="text-[10px] font-bold text-status-success/70">USD {formatUsdNumber(fromCentsUsd(totalPaidUsdCents))}</p>}
          </div>
        </div>

        <div className="relative">
          {!showConverter ? (
            <button 
              onClick={() => setShowConverter(true)}
              className="w-full h-8 bg-brand-gold-soft border border-brand-gold/30 rounded-lg flex items-center justify-center gap-2 text-brand-gold-deep font-black text-[10px] uppercase hover:bg-brand-gold hover:text-white transition-all shadow-sm"
            >
              <ArrowRightLeft size={12} /> Quiero Pagar (Información)
            </button>
          ) : (
            <div className="bg-ink p-3.5 rounded-xl border-2 border-brand-gold animate-in zoom-in-95 duration-200 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-brand-gold font-black text-[9px] uppercase tracking-[0.2em]">Calculadora de Equivalencia</h4>
                <button onClick={() => setShowConverter(false)} className="text-white/40 hover:text-white"><X size={14}/></button>
              </div>
              
              <div className="grid grid-cols-2 gap-3 items-start">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-white/40 uppercase block ml-1">Monto USD</label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-brand-gold" />
                    <input 
                      type="text" 
                      inputMode="decimal"
                      className="w-full h-9 bg-white/5 border border-white/10 rounded-lg pl-8 pr-2 text-white font-black text-base focus:border-brand-gold outline-none transition-all"
                      placeholder="0.00"
                      value={calcUSD}
                      onChange={e => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        setCalcUSD(val);
                        setLastEdited('USD');
                        const n = parseFloat(val) || 0;
                        setCalcBS((n * exchangeRate).toFixed(2));
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-black text-white/40 uppercase block ml-1">Monto Bs.</label>
                  <div className="relative">
                    <Banknote className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-brand-gold" />
                    <input 
                      type="text" 
                      inputMode="decimal"
                      className="w-full h-9 bg-white/5 border border-white/10 rounded-lg pl-8 pr-2 text-white font-black text-base focus:border-brand-gold outline-none transition-all"
                      placeholder="0.00"
                      value={calcBS}
                      onChange={e => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        setCalcBS(val);
                        setLastEdited('BS');
                        const n = parseFloat(val) || 0;
                        setCalcUSD((n / exchangeRate).toFixed(2));
                      }}
                    />
                  </div>
                </div>
              </div>

              {(calcUSD || calcBS) && (
                <div className="mt-3 p-2 bg-white/5 border border-white/10 rounded-lg text-center">
                  <span className="text-[7px] font-black text-white/30 uppercase tracking-[0.3em]">EQUIVALENCIA</span>
                  <div className="mt-0.5">
                    {lastEdited === 'USD' ? (
                      <p className="text-2xl font-black text-brand-gold leading-none">{formatBs(parseFloat(calcBS) || 0)}</p>
                    ) : (
                      <p className="text-2xl font-black text-brand-gold leading-none">{formatUsd(parseFloat(calcUSD) || 0)}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!showConverter && (
          <div className="grid grid-cols-[1fr_100px_auto] gap-2 items-end bg-white border border-line p-2 rounded-xl shadow-sm">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-ink/40 uppercase block ml-1">Método</label>
              <select
                value={currentMethod}
                onChange={(e) => setCurrentMethod(e.target.value)}
                className="w-full h-9 border-line bg-surface-soft rounded-lg px-2 text-[10px] font-black uppercase text-ink outline-none"
              >
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-ink/40 uppercase block ml-1">Monto</label>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full h-9 border-line bg-surface-soft rounded-lg px-2 text-xs font-black text-ink text-right outline-none"
                placeholder="0.00"
              />
            </div>
            <button onClick={() => addPayment()} className="h-9 w-9 bg-ink text-brand-gold rounded-lg flex items-center justify-center hover:bg-brand-gold-deep hover:text-white transition-all">
              <Plus size={18} />
            </button>
          </div>
        )}

        <div className="bg-surface-soft/50 rounded-xl border border-line overflow-hidden">
          <div className="px-3 py-1 bg-ink text-white/40 text-[8px] font-black uppercase tracking-widest">Pagos Registrados</div>
          <div className="max-h-20 overflow-y-auto divide-y divide-line/30">
            {payments.length === 0 ? (
              <div className="py-4 text-center text-[9px] font-black text-ink/20 uppercase italic">Esperando pagos...</div>
            ) : (
              payments.map(p => {
                const methodInfo = methods.find(m => m.id === p.method);
                return (
                  <div key={p.id} className="flex justify-between items-center p-2 bg-white hover:bg-brand-gold-soft/5 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-surface-soft flex items-center justify-center text-ink scale-90">
                        {methodInfo?.icon && <methodInfo.icon size={14} />}
                      </div>
                      <p className="text-[9px] font-black text-ink uppercase">{methodInfo?.label}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-black text-[10px] text-ink">{methodInfo?.currency === 'USD' ? formatUsd(p.usdAmount || 0) : formatBs(p.amount)}</span>
                      <button onClick={() => removePayment(p.id)} className="text-ink/20 hover:text-status-danger p-0.5"><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={cn(
          "rounded-2xl p-4 text-center border-2 transition-all duration-300 shadow-md",
          remainingCents > 0 ? "bg-status-danger-soft border-status-danger/20" : "bg-status-success-soft border-status-success/20"
        )}>
          {remainingCents > 0 ? (
            <div>
              <span className="text-[9px] font-black text-status-danger uppercase tracking-[0.2em] block mb-0.5">Monto Faltante</span>
              <p className="text-3xl font-black text-status-danger">{formatBs(remaining)}</p>
              <p className="text-[11px] font-bold text-status-danger/60 mt-0.5">≈ {formatUsd(remaining / exchangeRate)}</p>
            </div>
          ) : changeCents > 0 ? (
            <div>
              <span className="text-[9px] font-black text-status-success uppercase tracking-[0.2em] block mb-0.5">Vuelto en Bs.</span>
              <p className="text-3xl font-black text-status-success">{formatBs(change)}</p>
              <p className="text-[11px] font-bold text-status-success/60 mt-0.5">≈ {formatUsd(change / exchangeRate)}</p>
            </div>
          ) : (
            <div className="py-1 flex items-center justify-center gap-2">
              <div className="w-7 h-7 rounded-full bg-status-success text-white flex items-center justify-center shadow-md scale-90"><Check size={16} /></div>
              <p className="text-sm font-black text-status-success uppercase tracking-wider">Pago Exacto</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={setExactAmount}
            className="h-9 bg-white border-2 border-line text-ink font-black text-[9px] uppercase rounded-lg hover:bg-surface-soft"
          >
            Monto Exacto
          </button>
          <button
            onClick={confirmPayment}
            disabled={!canConfirm || isProcessing}
            className={cn(
              "h-9 rounded-lg text-white font-black text-[10px] uppercase tracking-widest transition-all",
              canConfirm ? "bg-status-success hover:brightness-110" : "bg-gray-300 cursor-not-allowed text-white/50"
            )}
          >
            {isProcessing ? "Espere..." : (isFullyPaid ? "Finalizar" : "Abonar")}
          </button>
        </div>
      </div>
    </div>
  );
}