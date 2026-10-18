"use client";

import React, { useState, useEffect } from 'react';
import { Plus, Search, User, Phone, MapPin, BadgeDollarSign, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Store } from '@/lib/db-store';
import { Customer } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from '@/hooks/use-toast';

export function CustomersModule() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [store, setStore] = useState<any>(Store.get());

  useEffect(() => {
    // ===== CORREGIDO: Store.get() sin argumentos =====
    const state = Store.get();
    setCustomers(state.clientes || []);
    
    const unsubscribe = Store.subscribe((newState: any) => {
      setStore(newState);
      setCustomers(newState.clientes || []);
    });
    return () => unsubscribe();
  }, []);

  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.cedula.includes(searchTerm)
  );

  // ===== FUNCIÓN PARA ELIMINAR CLIENTE =====
  const eliminarCliente = (cliente: Customer) => {
    // Verificar si el cliente tiene deudas pendientes
    const todasLasDeudas = store.cxc || [];
    const tieneDeudasPendientes = todasLasDeudas.some(
      (d: any) => d.cliente === cliente.name && d.estado !== 'pagada'
    );
    
    if (tieneDeudasPendientes) {
      toast({ 
        variant: "destructive",
        title: "No se puede eliminar", 
        description: `El cliente "${cliente.name}" tiene deudas pendientes.` 
      });
      return;
    }

    // Verificar si el cliente tiene deudas (aunque estén pagadas)
    const tieneDeudas = todasLasDeudas.some((d: any) => d.cliente === cliente.name);
    
    let mensajeConfirmacion = `¿Está seguro de eliminar permanentemente al cliente "${cliente.name}"`;
    if (tieneDeudas) {
      mensajeConfirmacion += " y todo su historial de deudas (pagadas)";
    }
    mensajeConfirmacion += "?";

    if (!confirm(mensajeConfirmacion)) {
      return;
    }

    // Eliminar cliente de la lista de clientes
    const clientesActualizados = customers.filter((c: Customer) => c.id !== cliente.id);
    
    // Eliminar todas las deudas del cliente
    const deudasActualizadas = todasLasDeudas.filter((d: any) => d.cliente !== cliente.name);
    
    // Actualizar el store
    Store.set({ 
      clientes: clientesActualizados, 
      cxc: deudasActualizadas 
    });
    
    setCustomers(clientesActualizados);
    
    toast({ 
      title: "Cliente eliminado", 
      description: `El cliente "${cliente.name}" ha sido eliminado permanentemente.` 
    });
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 overflow-hidden">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-primary">Directorio de Clientes</h2>
          <p className="text-sm text-muted-foreground">Historial y gestión de crédito de clientes</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 gap-2">
          <Plus className="w-5 h-5" /> Nuevo Cliente
        </Button>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Buscar por nombre o cédula..." 
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
                <TableHead className="font-bold">Cédula</TableHead>
                <TableHead className="font-bold">Nombre</TableHead>
                <TableHead className="font-bold">Teléfono</TableHead>
                <TableHead className="font-bold">Dirección</TableHead>
                <TableHead className="font-bold">Deuda BS</TableHead>
                <TableHead className="text-right font-bold">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                // Verificar si el cliente tiene deudas pendientes
                const todasLasDeudas = store.cxc || [];
                const tieneDeudasPendientes = todasLasDeudas.some(
                  (d: any) => d.cliente === c.name && d.estado !== 'pagada'
                );
                
                return (
                  <TableRow key={c.id} className="hover:bg-secondary/20">
                    <TableCell className="font-code text-primary text-xs font-bold">{c.cedula}</TableCell>
                    <TableCell className="font-semibold">{c.name}</TableCell>
                    <TableCell>{c.phone}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{c.address}</TableCell>
                    <TableCell>
                      <span className={`font-bold ${c.debt > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                        Bs. {c.debt.toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {/* ===== BOTÓN ELIMINAR - SOLO SI NO TIENE DEUDAS PENDIENTES ===== */}
                        {!tieneDeudasPendientes && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-red-500 hover:bg-red-500/10"
                            onClick={() => eliminarCliente(c)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}