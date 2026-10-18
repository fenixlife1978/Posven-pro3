"use client";

import React, { useState, useEffect } from 'react';
import { Vault, Lock, Unlock, History, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Store } from '@/lib/db-store';
import { toast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// Definir CashSession localmente
interface CashSession {
  openDate: string;
  openAmount: number;
  openAmountBs: number;
  openAmountUsd: number;
  openNotes?: string;
  closeDate: string | null;
  closeAmount: number | null;
  closeAmountBs: number | null;
  closeAmountUsd: number | null;
  closeNotes?: string | null;
  totalSales: number;
  totalSalesBs: number;
  totalSalesUsd: number;
  totalCollections: number;
  saleCount: number;
  difference?: number;
}

export function CashModule({ onStatusChange }: { onStatusChange: (s: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  
  // Montos de apertura
  const [openAmountBs, setOpenAmountBs] = useState('');
  const [openAmountUsd, setOpenAmountUsd] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  
  const [closeAmount, setCloseAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  useEffect(() => {
    const state = Store.get();
    setIsOpen(state.isCashOpen || false);
    setCurrentSession(state.cashData || null);
    setHistory(state.cashHistory || []);
    
    // Cargar montos actuales si existen
    if (state.fondoCajaHoyBS !== undefined && state.fondoCajaHoyBS > 0) {
      setOpenAmountBs(state.fondoCajaHoyBS.toString());
    }
    if (state.fondoCajaHoyUSD !== undefined && state.fondoCajaHoyUSD > 0) {
      setOpenAmountUsd(state.fondoCajaHoyUSD.toString());
    }
  }, []);

  const handleOpen = () => {
    const amountBs = parseFloat(openAmountBs) || 0;
    const amountUsd = parseFloat(openAmountUsd) || 0;
    
    // Validar que al menos un fondo tenga valor
    if (amountBs === 0 && amountUsd === 0) {
      toast({ 
        variant: "destructive", 
        title: "Error", 
        description: "Debe ingresar al menos un monto de apertura en Bs. o USD." 
      });
      return;
    }
    
    const session: CashSession = {
      openDate: new Date().toISOString(),
      openAmount: amountBs,
      openAmountBs: amountBs,
      openAmountUsd: amountUsd,
      openNotes,
      closeDate: null,
      closeAmount: null,
      closeAmountBs: null,
      closeAmountUsd: null,
      closeNotes: null,
      totalSales: 0,
      totalSalesBs: 0,
      totalSalesUsd: 0,
      totalCollections: 0,
      saleCount: 0
    };
    
    // ✅ ACTUALIZAR CORRECTAMENTE EL ESTADO GLOBAL (merge para no pisar otros datos)
    Store.set({
      fondoCajaHoyBS: amountBs,      // ✅ GUARDA EL MONTO EN BS
      fondoCajaHoyUSD: amountUsd,    // ✅ GUARDA EL MONTO EN USD
      isCashOpen: true,
      cashData: session
    });
    
    setIsOpen(true);
    setCurrentSession(session);
    onStatusChange(true);
    
    toast({ 
      title: "✅ Caja Abierta", 
      description: `Iniciada con Bs. ${amountBs.toFixed(2)} y $${amountUsd.toFixed(2)}` 
    });
  };

  const handleClose = () => {
    if (!currentSession) return;
    const amount = parseFloat(closeAmount) || 0;
    
    const closed: CashSession = {
      ...currentSession,
      closeDate: new Date().toISOString(),
      closeAmount: amount,
      closeAmountBs: amount,
      closeAmountUsd: currentSession.openAmountUsd || 0,
      closeNotes,
      difference: amount - (currentSession.openAmount + currentSession.totalSales + currentSession.totalCollections)
    };

    const currentState = Store.get();
    const newHistory = [closed, ...(currentState.cashHistory || [])];
    
    // ✅ LIMPIAR LOS FONDOS AL CERRAR (merge para no pisar otros datos)
    Store.set({
      fondoCajaHoyBS: 0,
      fondoCajaHoyUSD: 0,
      isCashOpen: false,
      cashData: null,
      cashHistory: newHistory
    });
    
    setIsOpen(false);
    setCurrentSession(null);
    setHistory(newHistory);
    onStatusChange(false);
    
    toast({ 
      title: "Caja Cerrada", 
      variant: closed.difference === 0 ? "default" : "destructive",
      description: closed.difference === 0 ? "Sin descuadres." : `Descuadre de Bs. ${closed.difference?.toFixed(2)}`
    });
  };

  const expectedTotal = currentSession ? (currentSession.openAmount + currentSession.totalSales + currentSession.totalCollections) : 0;
  const expectedTotalUsd = currentSession ? (currentSession.openAmountUsd || 0) + (currentSession.totalSalesUsd || 0) : 0;

  // Función para prellenar con valores de ejemplo (para pruebas)
  const fillExampleValues = () => {
    setOpenAmountBs('7369.30');
    setOpenAmountUsd('510.00');
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-primary">Control de Caja</h2>
          <p className="text-sm text-muted-foreground">Sesiones diarias y arqueo de efectivo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {!isOpen ? (
          <Card className="bg-emerald-500/5 border-emerald-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-500">
                <Unlock className="w-6 h-6" /> Abrir Nueva Sesión
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Vault className="w-4 h-4" /> Fondo Bs.
                  </Label>
                  <Input 
                    type="number" 
                    className="text-xl h-12 font-black bg-emerald-500/5 border-emerald-500/30" 
                    value={openAmountBs} 
                    onChange={(e) => setOpenAmountBs(e.target.value)}
                    placeholder="0.00"
                  />
                  <p className="text-[8px] text-muted-foreground">💰 Este monto aparecerá en Reportes X/Z como "FONDO DE APERTURA Bs."</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <DollarSign className="w-4 h-4" /> Fondo USD
                  </Label>
                  <Input 
                    type="number" 
                    className="text-xl h-12 font-black bg-emerald-500/5 border-emerald-500/30" 
                    value={openAmountUsd} 
                    onChange={(e) => setOpenAmountUsd(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                  />
                  <p className="text-[8px] text-muted-foreground">💰 Este monto aparecerá en Reportes X/Z como "FONDO DE APERTURA USD"</p>
                </div>
              </div>
              
              <div className="text-[10px] text-muted-foreground font-black uppercase bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                ⚠️ Estos montos aparecerán en los Reportes X y Z como "FONDO DE APERTURA"
              </div>
              
              <div className="space-y-2">
                <Label>Observaciones</Label>
                <Textarea placeholder="Notas de apertura..." value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} />
              </div>
              
              <Button className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 font-bold uppercase" onClick={handleOpen}>
                Confirmar Apertura
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-destructive/5 border-destructive/20 relative">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Lock className="w-6 h-6" /> Cerrar Sesión Actual
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-black/40 rounded-xl p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span>Apertura Bs.:</span>
                  <span className="font-bold">Bs. {currentSession?.openAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Apertura USD:</span>
                  <span className="font-bold">${(currentSession?.openAmountUsd || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Ventas (+) Bs.:</span>
                  <span className="font-bold text-emerald-500">Bs. {currentSession?.totalSales.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Ventas (+) USD:</span>
                  <span className="font-bold text-emerald-500">${(currentSession?.totalSalesUsd || 0).toFixed(2)}</span>
                </div>
                <div className="border-t border-white/10 pt-2 flex justify-between font-black text-primary">
                  <span>ESPERADO EN CAJA Bs.:</span>
                  <span>Bs. {expectedTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-black text-primary">
                  <span>ESPERADO EN CAJA USD:</span>
                  <span>${expectedTotalUsd.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Monto Físico Contado (BS)</Label>
                <Input 
                  type="number" 
                  className="text-2xl h-14 font-black bg-destructive/5 border-destructive/30" 
                  value={closeAmount} 
                  onChange={(e) => setCloseAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Observaciones de Cierre</Label>
                <Textarea placeholder="Descuadres o notas..." value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
              </div>
              <Button className="w-full h-14 bg-destructive hover:bg-destructive/90 font-bold uppercase" onClick={handleClose}>
                Confirmar Cierre de Caja
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="bg-secondary/20 border-border h-full flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <History className="w-5 h-5" /> Historial de Sesiones
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <div className="h-full overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Inicial Bs.</TableHead>
                    <TableHead>Inicial USD</TableHead>
                    <TableHead>Final</TableHead>
                    <TableHead>Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[10px]">{new Date(h.openDate).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs font-bold">Bs. {h.openAmount}</TableCell>
                      <TableCell className="text-xs font-bold">${(h.openAmountUsd || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-bold">Bs. {h.closeAmount}</TableCell>
                      <TableCell>
                        <Badge variant={(h.difference || 0) < 0 ? "destructive" : "secondary"}>
                          {h.difference?.toFixed(2)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}