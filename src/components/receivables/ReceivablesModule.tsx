"use client";

import React, { useState, useEffect } from 'react';
import { Search, HandCoins, History, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Store } from '@/lib/db-store';
import { Debt, Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from '@/hooks/use-toast';

export function ReceivablesModule() {
  const [receivables, setReceivables] = useState<Debt[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const state = Store.get();
    setReceivables(state.cxc || []);
    setCustomers(state.clientes || []);
  }, []);

  // ✅ AHORA MUESTRA TODOS LOS CLIENTES, NO SOLO LOS QUE DEBEN
  // Si un cliente no tiene deudas, aún aparece en la lista
  const allClientsWithDebts = React.useMemo(() => {
    // Primero, obtener todos los clientes que tienen deudas
    const clientsWithDebts = new Set(receivables.map(r => r.cliente));
    
    // Luego, agregar todos los clientes de la lista de clientes
    const allClientNames = new Set([
      ...clientsWithDebts,
      ...customers.map(c => c.name || '')
    ]);

    // Construir el objeto agrupado
    const groups: Record<string, { 
      clientName: string; 
      debts: Debt[]; 
      totalDebt: number; 
      totalPaid: number;
      totalOutstanding: number;
      hasDebts: boolean;
    }> = {};

    allClientNames.forEach(name => {
      if (!name) return;
      const clientDebts = receivables.filter(r => r.cliente === name);
      const totalDebt = clientDebts.reduce((sum, d) => sum + d.montoUSD, 0);
      const totalPaid = clientDebts.reduce((sum, d) => sum + (d.abonadoUSD || 0), 0);
      const totalOutstanding = clientDebts.reduce((sum, d) => sum + (d.saldoUSD || 0), 0);
      
      groups[name] = {
        clientName: name,
        debts: clientDebts,
        totalDebt,
        totalPaid,
        totalOutstanding,
        hasDebts: clientDebts.length > 0
      };
    });

    return groups;
  }, [receivables, customers]);

  // Filtrar por búsqueda
  const filteredClients = React.useMemo(() => {
    if (!searchTerm.trim()) return allClientsWithDebts;
    
    const term = searchTerm.toLowerCase();
    return Object.fromEntries(
      Object.entries(allClientsWithDebts).filter(([name, group]) =>
        name.toLowerCase().includes(term) ||
        group.debts.some(d => d.id?.toLowerCase().includes(term))
      )
    );
  }, [allClientsWithDebts, searchTerm]);

  const totalOutstanding = Object.values(allClientsWithDebts).reduce(
    (sum, g) => sum + g.totalOutstanding, 0
  );

  const handlePay = (id: string) => {
    const all = [...receivables];
    const idx = all.findIndex(r => r.id === id);
    if (idx < 0) return;

    const r = all[idx];
    const amount = r.saldoUSD;
    
    if (amount <= 0) {
      toast({ 
        title: "Sin saldo pendiente",
        description: "Esta deuda ya está completamente pagada."
      });
      return;
    }

    r.abonadoUSD = (r.abonadoUSD || 0) + amount;
    r.saldoUSD = 0;
    r.estado = 'pagada';
    
    // Add payment to history
    if (!r.historialPagos) r.historialPagos = [];
    r.historialPagos.push({
      fecha: new Date().toISOString(),
      montoUSD: amount,
      montoBS: amount * Store.get().tasa,
      metodo: 'efectivo_usd',
      reciboId: 'PAY-' + Date.now().toString(36).toUpperCase()
    });

    // Update customer debt
    const allCusts = [...customers];
    const cIdx = allCusts.findIndex(c => 
      c.name === r.cliente?.split('[')[0]?.trim() || ''
    );
    if (cIdx >= 0) {
      allCusts[cIdx].debt = Math.max(0, (allCusts[cIdx].debt || 0) - amount);
    }

    // Update state (merge en Store para no pisar otros datos)
    Store.set({
      cxc: all,
      clientes: allCusts
    });
    setReceivables(all);
    setCustomers(allCusts);
    
    toast({ 
      title: "Pago registrado exitosamente",
      description: `Se cobró ${amount.toFixed(2)} USD de ${r.cliente}`
    });
  };

  const getStatusBadge = (estado: string) => {
    switch (estado) {
      case 'pagada': 
        return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">PAGADA</Badge>;
      case 'parcial': 
        return <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">PARCIAL</Badge>;
      default: 
        return <Badge variant="destructive" className="bg-red-500/20 text-red-500 border-red-500/30">PENDIENTE</Badge>;
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 overflow-hidden">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-primary">Cuentas por Cobrar</h2>
          <p className="text-sm text-muted-foreground">Seguimiento de ventas a crédito y pagos pendientes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Por Cobrar</p>
            <p className="text-3xl font-black text-destructive">${totalOutstanding.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="bg-status-info-soft/10 border-status-info/20">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Deudas</p>
            <p className="text-3xl font-black text-status-info">{receivables.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Cobrado</p>
            <p className="text-3xl font-black text-emerald-500">
              ${receivables.reduce((sum, r) => sum + (r.abonadoUSD || 0), 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Buscar por cliente o factura..." 
          className="pl-9 bg-secondary/30"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <Card className="flex-1 overflow-hidden bg-card border-none shadow-xl">
        <div className="h-full overflow-y-auto">
          <Table>
            <TableHeader className="bg-secondary/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="font-bold">Cliente</TableHead>
                <TableHead className="font-bold text-right">Total USD</TableHead>
                <TableHead className="font-bold text-right">Abonado USD</TableHead>
                <TableHead className="font-bold text-right">Pendiente USD</TableHead>
                <TableHead className="font-bold text-center">Estado</TableHead>
                <TableHead className="font-bold text-center">Documentos</TableHead>
                <TableHead className="text-right font-bold">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(filteredClients).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-muted-foreground font-black uppercase">
                    No hay clientes registrados
                  </TableCell>
                </TableRow>
              ) : (
                Object.entries(filteredClients).map(([clientName, group]) => (
                  <TableRow key={clientName} className="hover:bg-secondary/20">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{clientName}</span>
                        {!group.hasDebts && (
                          <Badge variant="secondary" className="text-[8px] bg-gray-200 text-gray-500">
                            SIN DEUDAS
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold">${group.totalDebt.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-emerald-500">${group.totalPaid.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-destructive">${group.totalOutstanding.toFixed(2)}</TableCell>
                    <TableCell className="text-center">
                      {group.totalOutstanding > 0 ? (
                        <Badge variant="destructive" className="bg-red-500/20 text-red-500">PENDIENTE</Badge>
                      ) : group.hasDebts ? (
                        <Badge className="bg-emerald-500/20 text-emerald-500">CANCELADO</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-gray-200 text-gray-500">SIN DEUDAS</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="font-bold">
                        {group.debts.length} Facturas
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {group.totalOutstanding > 0 && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="gap-1 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
                          onClick={() => {
                            // Find first debt with balance
                            const debtWithBalance = group.debts.find(d => d.saldoUSD > 0);
                            if (debtWithBalance) handlePay(debtWithBalance.id);
                          }}
                        >
                          <HandCoins className="w-4 h-4" /> Cobrar
                        </Button>
                      )}
                      {group.totalOutstanding === 0 && group.hasDebts && (
                        <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-500">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Cancelado
                        </Badge>
                      )}
                      {!group.hasDebts && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-ink/30 cursor-default"
                          disabled
                        >
                          <History className="w-4 h-4 mr-1" /> Sin historial
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}