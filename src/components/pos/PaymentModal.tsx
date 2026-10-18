"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaymentMethod, Sale, SaleItem } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { toast } from '@/hooks/use-toast';
import { DollarSign, Banknote, CreditCard, Smartphone, CheckCircle2 } from 'lucide-react';

// Definir CartItem localmente
interface CartItem {
  productId: string;
  barcode: string;
  name: string;
  price: number;
  qty: number;
  maxStock: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  exchangeRate: number;
  onComplete: (sale: Sale) => void;
}

export function PaymentModal({ isOpen, onClose, cart, exchangeRate, onComplete }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('efectivo_bs');
  const [receivedBS, setReceivedBS] = useState<string>('');
  const [receivedUSD, setReceivedUSD] = useState<string>('');

  const totalBS = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const totalUSD = totalBS / exchangeRate;
  
  const actualReceived = method === 'efectivo_usd' || method === 'zelle' 
    ? (parseFloat(receivedUSD) || 0) * exchangeRate 
    : (parseFloat(receivedBS) || 0);

  const change = Math.max(0, actualReceived - totalBS);
  const isSufficient = actualReceived >= totalBS;

  const handleProcess = () => {
    if (!isSufficient) {
      toast({ title: "Monto insuficiente", variant: "destructive" });
      return;
    }

    // Obtener estado actual
    const currentState = Store.get();
    
    // Generar número de recibo
    const nextSaleNum = currentState.proximoRecibo || 1;
    const saleId = `V-${String(nextSaleNum).padStart(6, '0')}`;
    
    // Obtener productos actuales
    const products = currentState.productos || [];
    
    // Crear items de venta
    const saleItems: SaleItem[] = cart.map(item => ({
      productoId: item.productId,
      nombre: item.name,
      cantidad: item.qty,
      precioUnitUSD: item.price,
      subtotalUSD: item.price * item.qty
    }));

    // Actualizar stock
    const updatedProducts = products.map(p => {
      const cartItem = cart.find(item => item.productId === p.id);
      if (cartItem) {
        return { ...p, stock: (p.stock || 0) - cartItem.qty };
      }
      return p;
    });

    // Crear la venta
    const sale: Sale = {
      id: saleId,
      fecha: new Date().toISOString(),
      cliente: 'Consumidor final',
      items: saleItems,
      subtotalUSD: totalUSD,
      descuentoUSD: 0,
      totalUSD: totalUSD,
      totalBS: totalBS,
      metodoPago: method,
      estado: 'completada',
      type: 'VENTA',
      received: actualReceived,
      change: change,
      tasa: exchangeRate,
      payments: [{
        metodo: method,
        montoUSD: totalUSD,
        montoBS: totalBS
      }]
    };

    // Actualizar estado global (merge para no pisar otros datos)
    Store.set({
      proximoRecibo: nextSaleNum + 1,
      ventas: [...(currentState.ventas || []), sale],
      productos: updatedProducts
    });

    toast({ 
      title: "✅ Venta Exitosa", 
      description: `Venta ${saleId} procesada correctamente.` 
    });
    
    onComplete(sale);
    onClose();
    setReceivedBS('');
    setReceivedUSD('');
  };

  const methods: { id: PaymentMethod, label: string, icon: any }[] = [
    { id: 'efectivo_bs', label: 'Efectivo Bs.', icon: Banknote },
    { id: 'punto_venta', label: 'Punto de Venta', icon: CreditCard },
    { id: 'efectivo_usd', label: 'Efectivo USD', icon: DollarSign },
    { id: 'biopago', label: 'Biopago', icon: Smartphone },
    { id: 'pagomovil', label: 'PagoMovil', icon: Smartphone },
    { id: 'zelle', label: 'Zelle', icon: CreditCard },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card border-none text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-primary">Procesar Pago</DialogTitle>
        </DialogHeader>
        
        <div className="bg-black/40 rounded-2xl p-6 mb-6 text-center border border-primary/20">
          <p className="text-primary font-black text-4xl mb-1">Bs. {totalBS.toFixed(2)}</p>
          <p className="text-emerald-500 font-bold text-lg">≈ $ {totalUSD.toFixed(2)} USD</p>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {methods.map(m => (
            <Button 
              key={m.id}
              variant={method === m.id ? 'default' : 'secondary'}
              className={`h-auto flex-col py-3 gap-1 ${method === m.id ? 'bg-primary shadow-lg shadow-primary/30' : 'bg-secondary/50'}`}
              onClick={() => setMethod(m.id)}
            >
              <m.icon className="w-5 h-5" />
              <span className="text-[10px] uppercase font-bold">{m.label}</span>
            </Button>
          ))}
        </div>

        <div className="space-y-4">
          { (method === 'efectivo_usd' || method === 'zelle') ? (
            <div className="space-y-2">
              <Label>Monto en USD</Label>
              <Input 
                type="number" 
                placeholder="0.00" 
                className="h-12 text-xl font-bold bg-secondary/50" 
                value={receivedUSD}
                onChange={(e) => {
                  setReceivedUSD(e.target.value);
                  const val = parseFloat(e.target.value) || 0;
                  setReceivedBS((val * exchangeRate).toFixed(2));
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Monto Recibido BS</Label>
              <Input 
                type="number" 
                placeholder="0.00" 
                className="h-12 text-xl font-bold bg-secondary/50" 
                value={receivedBS}
                onChange={(e) => setReceivedBS(e.target.value)}
              />
            </div>
          )}

          {actualReceived > 0 && (
            <div className={`p-4 rounded-xl text-center font-bold ${isSufficient ? 'bg-emerald-500/20 text-emerald-500' : 'bg-destructive/20 text-destructive'}`}>
              {isSufficient ? `CAMBIO: Bs. ${change.toFixed(2)}` : `FALTA: Bs. ${(totalBS - actualReceived).toFixed(2)}`}
            </div>
          )}
        </div>

        <Button 
          className="w-full h-14 mt-4 bg-emerald-600 hover:bg-emerald-500 text-lg font-black uppercase tracking-widest"
          disabled={!isSufficient}
          onClick={handleProcess}
        >
          <CheckCircle2 className="w-6 h-6 mr-2" />
          Finalizar Venta
        </Button>
      </DialogContent>
    </Dialog>
  );
}