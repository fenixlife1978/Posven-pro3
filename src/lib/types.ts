export interface User {
  uid: string;
  nombre: string;
  email: string;
  rol: 'administrador' | 'cajero';
  accesoBloqueado: boolean;
  fechaCreacion?: string;
  isAuthenticated?: boolean;
}

export interface Product {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  departamento: string;
  cantidad: string;
  marca: string;
  costoUSD: number;
  precioUSD: number;
  precioEstandarUSD?: number;
  precioMayorUSD?: number;
  precioOfertaUSD?: number;
  precioPromoUSD?: number;
  tipoPrecioPrincipal?: 'estandar' | 'mayor' | 'oferta' | 'promo';
  margen: number;
  stock: number;
  stockMinimo: number;
  fechaCreacion: string;
  activo: boolean;
  aplicaIVA?: boolean;
  isKit?: boolean;
  kitType?: 'stock_propio' | 'stock_componentes';
  kitItems?: KitItem[];
  proveedor?: string;
  
  // ========== PROPIEDADES PARA ProductForm ==========
  barcode?: string;
  internalCode?: string;
  alternateCode?: string;
  description?: string;
  shortDescription?: string;
  type?: string;
  groupId?: number;
  subgroupId?: number;
  brandId?: number;
  lineId?: number;
  model?: string;
  color?: string;
  size?: string;
  supplierId?: number;
  supplierCode?: string;
  unit?: string;
  altUnit?: string;
  conversionFactor?: number;
  minStock?: number;
  maxStock?: number;
  reorderPoint?: number;
  warehouse?: string;
  managesLots?: boolean;
  managesSerials?: boolean;
  managesExpiration?: boolean;
  costPrice?: number;
  profitPercentage?: number;
  priceVES?: number;
  prices?: PriceTier[];
  taxType?: string;
  ivaRate?: number;
  igtfRate?: number;
  maxDiscount?: number;
  netWeight?: number;
  grossWeight?: number;
  volume?: number;
  barcodeLabel?: string;
  observations?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriceTier {
  name: string;
  usd: number;
  ves: number;
}

export interface KitItem {
  productoId: string;
  nombre: string;
  cantidad: number;
}

export interface Movimiento {
  id: string;
  productoId: string;
  tipo: 'ajuste_entrada' | 'ajuste_salida' | 'consumo' | 'colaboracion' | 'compra' | 'venta' | 'devolucion' | 'anulacion' | 'cobro_deuda' | 'inicial';
  cantidad: number;
  stockAntes: number;
  stockDespues: number;
  fecha: string;
  referencia: string;
  terminalId?: string;
}

export interface SaleItem {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitUSD: number;
  subtotalUSD: number;
}

export interface PurchaseItem {
  productoId: string;
  nombre: string;
  cantidad: number;
  costoUnitarioUSD: number;
  subtotalUSD: number;
}

export interface PurchaseRecord {
  id: string;
  fecha: string;
  fechaHora?: string;
  proveedor: string;
  numeroFactura: string;
  condicion: 'contado' | 'credito' | 'mixto';
  montoUSD: number;
  pagadoUSD: number;
  saldoUSD: number;
  items: PurchaseItem[];
  terminalId?: string;
}

export interface PagoRealizado {
  metodo: PaymentMethod;
  montoUSD: number;
  montoBS: number;
}

export interface Sale {
  id: string;
  fecha: string;
  cliente: string;
  items: SaleItem[];
  subtotalUSD: number;
  descuentoUSD: number;
  totalUSD: number;
  totalBS: number;
  metodoPago: string;
  estado: string;
  type?: string;
  received?: number;
  change?: number;
  terminalId?: string;
  terminalName?: string;
  cajeroId?: string;
  cajeroNombre?: string;
  payments?: PagoRealizado[];
  baseImponibleUSD?: number;
  ivaUSD?: number;
  exentoUSD?: number;
  igtfUSD?: number;
  tasa: number;
}

export interface Customer {
  id: string;
  name: string;
  cedula: string;
  phone: string;
  address: string;
  debt: number;
}

export interface Debt {
  id: string;
  fecha: string;
  fechaVencimiento: string;
  cliente?: string;
  proveedor?: string;
  numeroFactura?: string;
  montoUSD: number;
  abonadoUSD: number;
  saldoUSD: number;
  estado: 'pendiente' | 'parcial' | 'pagada';
  historialPagos: Array<{
    fecha: string;
    montoUSD: number;
    montoBS: number;
    metodo: string;
    reciboId: string;
  }>;
  ventaId?: string;
  items?: any[];
  concepto?: string;
}

export interface LibroDiarioEntry {
  id: string;
  fecha: string;
  tipo: 'ingreso' | 'egreso';
  categoria: string;
  concepto: string;
  montoUSD: number;
  montoBS: number;
  metodo: string;
  referencia: string;
}

export interface Terminal {
  id: string;
  nombre: string;
  usuarioId: string | null;
  activo: boolean;
  proximoRecibo: number;
}

export interface Supplier {
  id: string;
  nombre: string;
  rif: string;
  contacto: string;
  direccion: string;
  telefono: string;
}

export interface ReturnItem {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitUSD: number;
  estadoProducto: 'REINTEGRADO_STOCK' | 'MERMA_DANADO';
}

export interface Return {
  id: string;
  ventaId: string;
  fecha: string;
  items: ReturnItem[];
  totalUSD: number;
  metodoReembolso: string;
  motivo: string;
}

export interface Anulacion {
  id: string;
  ventaId: string;
  fecha: string;
  totalUSD: number;
  motivo: string;
  items: any[];
}

export interface ReportZ {
  id: string;
  fecha: string;
  numeroZ: number;
  terminalName: string;
  desdeFactura: string;
  hastaFactura: string;
  desdeNotaCredito: string;
  hastaNotaCredito: string;
  cantidadAnuladas: number;
  ventaBrutaUSD: number;
  descuentoUSD: number;
  devolucionesUSD: number;
  ventaNetaUSD: number;
  baseImponibleUSD: number;
  ivaUSD: number;
  exentoUSD: number;
  igtfUSD: number;
  metodosPago: Record<string, number>;
  salidasCajaUSD: number;
  entradasCajaUSD: number;
  fondoAperturaUSD: number;
  fondoAperturaBS: number;
  acumuladoHistoricoUSD: number;
  stats: {
    facturas: number;
    devoluciones: number;
    anulaciones: number;
    ticketPromedio: number;
  };
}

// ========== TIPOS PARA ProductForm ==========
export interface Brand {
  id: number;
  name: string;
}

export interface Group {
  id: number;
  name: string;
}

export interface Subgroup {
  id: number;
  name: string;
  groupId: number;
}

export interface Line {
  id: number;
  name: string;
}

export interface SupplierForm {
  id: number;
  name: string;
  code?: string;
}

export interface Config {
  exchangeRate: number;
  ivaRate: number;
  igtfRate: number;
}

// ========== CASH SESSION ==========
export interface CashSession {
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

// ========== APP STATE ACTUALIZADO ==========
export interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  tasa: number;
  pinDevolucion: string;
  isInitialized?: boolean;
  productos: Product[];
  ventas: Sale[];
  cxc: Debt[];
  cxp: Debt[];
  clientes: Customer[];
  devoluciones: Return[];
  anulaciones: Anulacion[];
  movimientos: Movimiento[];
  libroDiario: LibroDiarioEntry[];
  carrito: SaleItem[];
  terminales: Terminal[];
  reportesZ: ReportZ[];
  ultimoZ: number;
  proximoRecibo: number;
  proximaDevolucion: number;
  proximaAnulacion: number;
  acumuladoHistorico: number;
  fechaUltimoZ?: string;
  fondoCajaHoyUSD: number;
  fondoCajaHoyBS: number;
  
  // ========== PROPIEDADES PARA CASH MODULE ==========
  isCashOpen: boolean;
  cashData: CashSession | null;
  cashHistory: CashSession[];
  
  empresa: {
    nombre: string;
    rif: string;
    direccion: string;
    telefono: string;
  };
  departamentos: string[];
  categorias: string[];
  marcas: string[];
  presentaciones: string[];
  proveedores: Supplier[];
  compras: PurchaseRecord[];
  
  // ========== NUEVAS PROPIEDADES PARA ProductForm ==========
  config: Config;
  productCategories: string[];
  productUnits: string[];
  productColors: string[];
  productSizes: string[];
  brands: Brand[];
  groups: Group[];
  subgroups: Subgroup[];
  lines: Line[];
  suppliers: SupplierForm[];
  products: Product[];
  marcasString: string[];
  proveedoresString: string[];
}

export type PaymentMethod = 'efectivo_usd' | 'efectivo_bs' | 'punto_venta' | 'biopago' | 'pagomovil' | 'zelle' | 'transferencia' | 'credito' | 'mixto' | 'otros' | 'nota_credito';

export function getProductBarcode(product: Product | any): string {
  return product?.codigo || product?.barcode || product?.sku || '';
}

export function getProductPrice(product: Product | any): number {
  return product?.precioUSD || product?.price || product?.precio || 0;
}