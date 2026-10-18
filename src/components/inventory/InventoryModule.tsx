"use client";

import React, { useState, useEffect } from 'react';
import { Plus, Search, Filter, Pencil, Trash2, PackageCheck, AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Store } from '@/lib/db-store';
import { Product, getProductBarcode, getProductPrice, AppState } from '@/lib/types';
import { toast } from '@/hooks/use-toast';
import { ProductFormModal } from './ProductFormModal';
import { generarPDFInventario } from '@/lib/pdf-generator';

interface InventoryModuleProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

export function InventoryModule({ state, updateState }: InventoryModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>(undefined);

  useEffect(() => {
    refreshData();
    
    // Escuchar escaneos de código de barras globales
    const handleScan = (e: any) => {
      setSearchTerm(e.detail);
    };
    window.addEventListener('barcode-scanned', handleScan);
    return () => window.removeEventListener('barcode-scanned', handleScan);
  }, []);

  const refreshData = () => {
    // Obtener productos del estado
    const allProducts = state?.productos || [];
    setProducts(allProducts);
  };

  const filteredProducts = products.filter(p => {
    const barcode = getProductBarcode(p);
    const matchesSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (barcode && barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter ? p.categoria === categoryFilter : true;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(products.map(p => p.categoria)));

  const handleDelete = (id: string) => {
    if (confirm('¿Eliminar este producto?')) {
      const all = products.filter(p => p.id !== id);
      // Actualizar estado
      updateState({ productos: all });
      refreshData();
      toast({ title: "Producto eliminado" });
    }
  };

  const lowStockCount = products.filter(p => (p.stock || 0) <= (p.stockMinimo || 0)).length;

  const handleGeneratePDF = async () => {
    try {
      await generarPDFInventario(products);
      toast({ 
        title: "PDF generado exitosamente", 
        description: "El reporte se ha descargado" 
      });
    } catch (error) {
      toast({ 
        title: "Error al generar PDF", 
        description: "Por favor intenta nuevamente" 
      });
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 overflow-hidden">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#c8952e]">Gestión de Inventario</h2>
          <p className="text-sm text-white/50">Control de existencias y catálogo de productos</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="gap-2 border-[#2a2a2a] text-white hover:bg-[#2a2a2a]"
            onClick={handleGeneratePDF}
          >
            <FileText className="w-5 h-5" /> Reporte PDF
          </Button>
          <Button className="bg-[#c8952e] hover:bg-[#d9a540] gap-2 text-[#0b0b0b] font-black" onClick={() => { setSelectedProduct(undefined); setIsModalOpen(true); }}>
            <Plus className="w-5 h-5" /> Agregar Producto
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-[#131313] border-[#2a2a2a]">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#c8952e]/20 rounded-xl"><PackageCheck className="w-6 h-6 text-[#c8952e]" /></div>
              <div>
                <p className="text-sm text-white/50">Total Productos</p>
                <p className="text-2xl font-black text-white">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-[#2a2a2a] ${lowStockCount > 0 ? 'bg-red-500/10' : 'bg-[#131313]'}`}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${lowStockCount > 0 ? 'bg-red-500/20 text-red-500' : 'bg-[#2a2a2a]/20 text-white/50'}`}>
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-white/50">Stock Bajo</p>
                <p className={`text-2xl font-black ${lowStockCount > 0 ? 'text-red-500' : 'text-white'}`}>{lowStockCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/50" />
          <Input 
            placeholder="Buscar por nombre o código de barras..." 
            className="pl-9 bg-[#0b0b0b] border-[#2a2a2a] text-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-white/50" />
          <select 
            className="bg-[#0b0b0b] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm outline-none text-white"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden bg-[#131313] border-[#2a2a2a] shadow-xl">
        <div className="h-full overflow-y-auto">
          <Table>
            <TableHeader className="bg-[#0b0b0b] sticky top-0 z-10">
              <TableRow className="border-[#2a2a2a]">
                <TableHead className="font-bold text-white/70">Código</TableHead>
                <TableHead className="font-bold text-white/70">Producto</TableHead>
                <TableHead className="font-bold text-white/70">Categoría</TableHead>
                <TableHead className="font-bold text-white/70">Precio USD</TableHead>
                <TableHead className="font-bold text-white/70">Stock</TableHead>
                <TableHead className="font-bold text-white/70">Estado</TableHead>
                <TableHead className="text-right font-bold text-white/70">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((p) => {
                const barcode = getProductBarcode(p);
                const price = getProductPrice(p);
                const stock = p.stock || 0;
                const minStock = p.stockMinimo || 0;
                return (
                  <TableRow key={p.id} className="hover:bg-[#1a1a1a] transition-colors border-[#2a2a2a]">
                    <TableCell className="font-code text-[#c8952e] text-xs font-bold">{barcode || 'N/A'}</TableCell>
                    <TableCell className="font-semibold text-white">{p.nombre}</TableCell>
                    <TableCell className="text-white/70">{p.categoria}</TableCell>
                    <TableCell className="font-bold text-[#c8952e]">${price.toFixed(2)}</TableCell>
                    <TableCell className="text-white">{stock}</TableCell>
                    <TableCell>
                      <Badge variant={stock <= minStock ? "destructive" : "secondary"} className={stock <= minStock ? "bg-red-500/20 text-red-500" : "bg-[#2a2a2a] text-white/70"}>
                        {stock <= minStock ? "Stock Bajo" : "Disponible"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="text-[#c8952e] hover:bg-[#c8952e]/10" onClick={() => { setSelectedProduct(p); setIsModalOpen(true); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-500/10" onClick={() => handleDelete(p.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-white/50">
                    No se encontraron productos en el inventario.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <ProductFormModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        product={selectedProduct}
        onSave={refreshData}
        state={state}
        updateState={updateState}
      />
    </div>
  );
}