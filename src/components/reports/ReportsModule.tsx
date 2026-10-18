"use client";

import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Sparkles, ShoppingBag, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Store } from '@/lib/db-store';
import { Sale, Product, SaleItem } from '@/lib/types';
import { getAISalesIntel, AISalesIntelOutput } from '@/ai/flows/ai-sales-intel-recommendations';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ReportsModule() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<AISalesIntelOutput | null>(null);

  useEffect(() => {
    const state = Store.get();
    setSales(state.ventas || []);
  }, []);

  const totalBS = sales.reduce((acc, s) => acc + s.totalBS, 0);
  const totalUSD = sales.reduce((acc, s) => acc + s.totalUSD, 0);

  const fetchAiIntel = async () => {
    setIsAiLoading(true);
    try {
      // Map store sales to AI format - usando las propiedades correctas de Sale
      const salesData = sales.map(s => ({
        saleId: s.id,
        date: s.fecha, // Cambiado de 'date' a 'fecha'
        items: s.items.map((i: SaleItem) => ({
          productId: i.productoId, // Cambiado de 'productId' a 'productoId'
          name: i.nombre, // Cambiado de 'name' a 'nombre'
          qty: i.cantidad, // Cambiado de 'qty' a 'cantidad'
          price: i.precioUnitUSD // Cambiado de 'price' a 'precioUnitUSD'
        }))
      }));

      const currentState = Store.get();
      const exchangeRate = currentState.tasa || 36.5;
      const result = await getAISalesIntel({ salesData, exchangeRateBSUSD: exchangeRate });
      setAiReport(result);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-primary uppercase italic tracking-tighter">Panel de Inteligencia</h2>
          <p className="text-sm text-muted-foreground">Reportes de ventas y predicciones con IA</p>
        </div>
        <Button 
          className="bg-primary hover:bg-primary/90 gap-2 shadow-lg shadow-primary/30 h-12" 
          onClick={fetchAiIntel}
          disabled={isAiLoading || sales.length === 0}
        >
          {isAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {aiReport ? "Actualizar Predicción" : "Generar Insights con IA"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-secondary/20 border-border">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/20 rounded-xl"><BarChart3 className="w-6 h-6 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Ventas Totales BS</p>
                <p className="text-2xl font-black">Bs. {totalBS.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-500/20 rounded-xl"><TrendingUp className="w-6 h-6 text-emerald-500" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Ventas Totales USD</p>
                <p className="text-2xl font-black text-emerald-500">$ {totalUSD.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {aiReport && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-primary/5 border-primary/20 shadow-xl shadow-primary/5 overflow-hidden">
            <CardHeader className="bg-primary/10 border-b border-primary/10">
              <CardTitle className="text-lg flex items-center gap-2 text-primary uppercase tracking-widest font-black italic">
                <Sparkles className="w-5 h-5" /> Recomendaciones de Reabastecimiento
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Producto</TableHead>
                    <TableHead className="font-bold text-center">Cantidad Sugerida</TableHead>
                    <TableHead className="font-bold">Análisis de Demanda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiReport.restockingRecommendations.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-bold">{r.productName}</TableCell>
                      <TableCell className="text-center">
                        <span className="px-3 py-1 bg-primary/20 rounded-full font-black text-primary">{r.quantityToOrder}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground leading-relaxed italic">"{r.reason}"</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="bg-secondary/40 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg text-primary font-bold">Pronóstico Semanal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-black/30 rounded-xl space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Ingreso Proyectado</p>
                <p className="text-2xl font-black text-primary">Bs. {aiReport.weeklySalesForecast.totalRevenueBS.toFixed(2)}</p>
                <p className="text-emerald-500 font-bold">$ {aiReport.weeklySalesForecast.totalRevenueUSD.toFixed(2)} USD</p>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed p-4 border border-border/50 rounded-xl italic">
                {aiReport.weeklySalesForecast.forecastDetails}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="bg-card border-none shadow-xl">
        <CardHeader>
          <CardTitle>Historial de Transacciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>N° Factura</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Total BS</TableHead>
                <TableHead>Cliente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.slice().reverse().map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{new Date(s.fecha).toLocaleString()}</TableCell> {/* Cambiado de 'date' a 'fecha' */}
                  <TableCell className="font-code font-bold text-primary">{s.id}</TableCell>
                  <TableCell>{s.type || 'VENTA'}</TableCell>
                  <TableCell className="font-bold">Bs. {s.totalBS.toFixed(2)}</TableCell>
                  <TableCell>{s.cliente || 'Venta General'}</TableCell> {/* Cambiado de 'customerName' a 'cliente' */}
                </TableRow>
              ))}
              {sales.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 opacity-50 italic">Aún no hay transacciones registradas.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}