import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Product, Movimiento, Sale, Supplier, LibroDiarioEntry, Terminal } from './types';

// Helper para formatear moneda en USD
const fmt = (v: number) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (v: number) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

interface CompanyInfo {
  nombre: string;
  direccion: string;
  rif: string;
  telefono: string;
}

/**
 * Dibuja el encabezado profesional de forma dinámica
 */
const drawHeader = (doc: jsPDF, title: string, empresa: CompanyInfo): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const usableWidth = pageWidth - (margin * 2);

  // 1. Bloque Izquierdo: Datos de la Empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  
  const companyName = (empresa.nombre || 'NEGOCIO').toUpperCase();
  const companyLines = doc.splitTextToSize(companyName, usableWidth * 0.55);
  doc.text(companyLines, margin, 18);
  
  let leftY = 18 + (companyLines.length * 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  
  const address = (empresa.direccion || 'DIRECCION').toUpperCase();
  const addressLines = doc.splitTextToSize(address, usableWidth * 0.55);
  doc.text(addressLines, margin, leftY);
  
  leftY += (addressLines.length * 3.5);
  doc.text(`RIF: ${empresa.rif} | TEL: ${empresa.telefono}`, margin, leftY);
  leftY += 5;

  // 2. Bloque Derecho: Título y Fecha
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(200, 149, 46); // Color Brand Gold
  
  const titleLines = doc.splitTextToSize(title.toUpperCase(), usableWidth * 0.40);
  doc.text(titleLines, pageWidth - margin, 18, { align: 'right' });
  
  let rightY = 18 + (titleLines.length * 5.5);
  
  const now = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`GENERADO EL: ${now}`, pageWidth - margin, rightY, { align: 'right' });
  rightY += 5;

  const headerBottomY = Math.max(leftY, rightY) + 2;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(margin, headerBottomY, pageWidth - margin, headerBottomY);
  
  return headerBottomY + 5;
};

// Reporte de Libro Diario (Ingresos y Egresos)
export const exportarPDFLibroDiario = (diario: LibroDiarioEntry[], empresa: CompanyInfo, totals: any) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Libro Diario de Ingresos y Egresos', empresa);

  doc.setFillColor(20, 20, 20);
  doc.rect(15, startY, 186, 12, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`TOTAL INGRESOS: ${fmt(totals.totalIngresos)}`, 20, startY + 8);
  doc.text(`TOTAL EGRESOS: ${fmt(totals.totalEgresos)}`, 85, startY + 8);
  doc.text(`BALANCE NETO: ${fmt(totals.balanceNeto)}`, 150, startY + 8);

  autoTable(doc, {
    startY: startY + 16,
    head: [['FECHA', 'CONCEPTO / CATEGORÍA', 'MÉTODO', 'INGRESO ($)', 'EGRESO ($)']],
    body: diario.map(e => [
      e.fecha.slice(0, 10),
      `${e.concepto}\n[${e.categoria}]`,
      e.metodo.toUpperCase(),
      e.tipo === 'ingreso' ? fmt(e.montoUSD) : '-',
      e.tipo === 'egreso' ? fmt(e.montoUSD) : '-'
    ]),
    headStyles: { fillColor: [40, 40, 40] },
    styles: { fontSize: 7.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  doc.save(`Libro_Diario_${new Date().getTime()}.pdf`);
};

// 1. Reporte de Inventario Simple (Catálogo)
export const generarPDFInventarioSimple = (products: Product[], empresa: CompanyInfo) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Catálogo Maestro de Productos', empresa);

  autoTable(doc, {
    startY: startY,
    head: [['CÓDIGO', 'NOMBRE DEL PRODUCTO', 'CATEGORÍA', 'COSTO (USD)', 'VENTA (USD)', 'STOCK']],
    body: products.map(p => [
      p.codigo,
      p.nombre.toUpperCase(),
      p.categoria.toUpperCase(),
      fmt(p.costoUSD),
      fmt(p.precioUSD),
      p.stock.toString()
    ]),
    headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: [248, 246, 240] },
    margin: { left: 15, right: 15 }
  });

  doc.save(`Inventario_Maestro_${new Date().getTime()}.pdf`);
};

// 2. Reporte General (Detallado por Grupo)
export const exportarPDFInventarioGeneral = (productos: Product[], empresa: CompanyInfo, groupBy: string, totals: any) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const headerY = drawHeader(doc, `Inventario Valorizado por ${groupBy}`, empresa);

  doc.setFillColor(248, 246, 240);
  doc.rect(15, headerY, 186, 12, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(`VALOR TOTAL AL COSTO (CPP): ${fmt(totals.costo)}`, 20, headerY + 8);
  doc.text(`VALOR TOTAL A LA VENTA: ${fmt(totals.venta)}`, 110, headerY + 8);

  const uniqueGroups = Array.from(new Set(productos.map(p => (p[groupBy as keyof Product] as string) || 'SIN ASIGNAR'))).sort();
  let currentY = headerY + 16;

  uniqueGroups.forEach((groupName) => {
    const groupProds = productos.filter(p => ((p[groupBy as keyof Product] as string) || 'SIN ASIGNAR') === groupName);
    
    if (currentY > 230) {
      doc.addPage();
      currentY = drawHeader(doc, `Inventario Valorizado por ${groupBy}`, empresa);
    }

    doc.setFillColor(200, 149, 46);
    doc.rect(15, currentY, 186, 7, 'F');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(`${groupBy.toUpperCase()}: ${groupName.toUpperCase()} (${groupProds.length} ÍTEMS)`, 18, currentY + 5);
    
    autoTable(doc, {
      startY: currentY + 7,
      head: [['CÓDIGO', 'PRODUCTO', 'COSTO UNIT.', 'PRECIO UNIT.', 'STOCK', 'SUBTOTAL COSTO']],
      body: groupProds.map(p => [
        p.codigo,
        p.nombre.toUpperCase(),
        fmt(p.costoUSD),
        fmt(p.precioUSD),
        p.stock,
        fmt(p.costoUSD * p.stock)
      ]),
      headStyles: { fillColor: [40, 40, 40] },
      styles: { fontSize: 7.5 },
      theme: 'grid',
      margin: { left: 15, right: 15 }
    });

    currentY = (doc as any).lastAutoTable.finalY + 8;
  });

  doc.save(`Reporte_Inventario_Valorizado_${new Date().getTime()}.pdf`);
};

// 3. Reporte de Ventas Administrativo
export const exportarPDFVentasDetallado = (ventas: any[], empresa: CompanyInfo, periodo: string, stats: any) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Reporte Administrativo de Ventas', empresa);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`PERIODO AUDITADO: ${periodo.toUpperCase()}`, 15, startY + 5);
  doc.text(`VOLUMEN TOTAL: ${stats.totalVendidos} UNIDADES VENDIDAS`, 15, startY + 10);

  autoTable(doc, {
    startY: startY + 15,
    head: [['FECHA', 'RECIBO', 'PRODUCTO', 'MÉTODO', 'CANT.', 'P. UNIT.', 'TOTAL (USD)']],
    body: ventas.flatMap(v => v.items.map((item: any, idx: number) => [
      idx === 0 ? v.fecha.slice(0, 10) : '',
      idx === 0 ? v.id : '',
      item.nombre.toUpperCase(),
      v.metodoPago.toUpperCase(),
      item.cantidad,
      fmt(item.precioUnitUSD),
      fmt(item.subtotalUSD)
    ])),
    headStyles: { fillColor: [20, 20, 20] },
    styles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  doc.save(`Reporte_Ventas_${new Date().getTime()}.pdf`);
};

// 4. Reporte de Kardex (Ficha Técnica)
export const exportarPDFKardex = (producto: Product, movimientos: Movimiento[], empresa: CompanyInfo, terminales: Terminal[]) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Kardex Histórico de Movimientos', empresa);

  doc.setFillColor(248, 246, 240);
  doc.rect(15, startY, 186, 12, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(200, 149, 46);
  doc.text(`ITEM: ${producto.nombre.toUpperCase()}`, 20, startY + 8);
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`CÓDIGO: ${producto.codigo} | STOCK ACTUAL: ${producto.stock}`, 120, startY + 8);

  // Asegurar orden cronológico estricto (DESC)
  const sortedMovs = [...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));

  autoTable(doc, {
    startY: startY + 16,
    head: [['FECHA Y HORA', 'TIPO', 'CANT.', 'STOCK ANT.', 'NUEVO STOCK', 'TERMINAL', 'REFERENCIA']],
    body: sortedMovs.map(m => [
      m.fecha.replace('T', ' ').slice(0, 19),
      m.tipo.replace('_', ' ').toUpperCase(),
      m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad,
      m.stockAntes,
      m.stockDespues,
      (terminales.find(t => t.id === m.terminalId)?.nombre || m.terminalId || 'ADMIN').toUpperCase(),
      m.referencia.toUpperCase()
    ]),
    headStyles: { fillColor: [40, 40, 40] },
    styles: { fontSize: 6.5, cellPadding: 2 }
  });

  doc.save(`Kardex_${producto.codigo}_${new Date().getTime()}.pdf`);
};

// 5. Historial de Ajustes de Almacén
export const exportarPDFHistorialAjustes = (ajustes: any[], empresa: CompanyInfo, efectoNeto: number) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Bitácora de Ajustes Manuales', empresa);

  if (efectoNeto < 0) {
    doc.setFillColor(255, 235, 235);
  } else {
    doc.setFillColor(235, 255, 235);
  }
  
  doc.rect(15, startY, 186, 10, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(`VARIACIÓN NETA DE CAPITAL EN INVENTARIO: ${fmt(efectoNeto)}`, 20, startY + 6.5);

  autoTable(doc, {
    startY: startY + 15,
    head: [['FECHA', 'PRODUCTO AJUSTADO', 'TIPO', 'CANT.', 'COSTO UNIT.', 'TOTAL $', 'REFERENCIA']],
    body: ajustes.map(m => [
      m.fecha.replace('T', ' ').slice(0, 16),
      m.nombreProd.toUpperCase(),
      m.tipo.toUpperCase(),
      m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad,
      fmt(m.costo || 0),
      fmt(Math.abs(m.cantidad) * (m.costo || 0)),
      m.referencia.toUpperCase()
    ]),
    headStyles: { fillColor: [40, 40, 40] },
    styles: { fontSize: 7 }
  });

  doc.save(`Ajustes_Almacen_${new Date().getTime()}.pdf`);
};

// 6. Reporte de Consumo y Colaboraciones
export const exportarPDFConsumoInterno = (movs: any[], empresa: CompanyInfo, totalPerdida: number) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Reporte de Consumo Interno', empresa);

  doc.setFillColor(255, 235, 235);
  doc.rect(15, startY, 186, 10, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 0, 0);
  doc.text(`PÉRDIDA TOTAL POR CONSUMO/COLABORACIÓN: ${fmt(totalPerdida)}`, 20, startY + 6.5);

  autoTable(doc, {
    startY: startY + 15,
    head: [['FECHA', 'PRODUCTO', 'MOTIVO', 'P. UNITARIO', 'CANTIDAD', 'SUBTOTAL COSTO']],
    body: movs.map(m => [
      m.fecha.slice(0, 10),
      m.nombreProd.toUpperCase(),
      m.tipo.toUpperCase(),
      fmt(m.costoUnit),
      Math.abs(m.cantidad),
      fmt(m.subtotal)
    ]),
    headStyles: { fillColor: [150, 0, 0] },
    styles: { fontSize: 8 }
  });

  doc.save(`Consumo_Interno_${new Date().getTime()}.pdf`);
};

// 7. Reporte de Devoluciones
export const exportarPDFDevoluciones = (devoluciones: any[], empresa: CompanyInfo, periodo: string, stats: any) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Auditoría de Devoluciones y Notas de Crédito', empresa);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL REEMBOLSADO EN PERIODO: ${fmt(stats.totalUSD)}`, 15, startY + 5);

  autoTable(doc, {
    startY: startY + 12,
    head: [['FECHA', 'ID DEV.', 'VENTA REF.', 'ITEMS DEVUELTOS', 'CANT. TOTAL', 'TOTAL $', 'MOTIVO']],
    body: devoluciones.map(d => [
      d.fecha.slice(0, 10),
      d.id,
      d.ventaId,
      d.items.map((it: any) => it.nombre.toUpperCase()).join('\n'),
      d.items.reduce((s: number, it: any) => s + it.cantidad, 0),
      fmt(d.totalUSD),
      d.motivo.toUpperCase()
    ]),
    headStyles: { fillColor: [180, 50, 50] },
    styles: { fontSize: 6.5 }
  });

  doc.save(`Devoluciones_Auditoria_${new Date().getTime()}.pdf`);
};

// 8. Reporte de Cuentas por Cobrar (CxC)
export const exportarPDFCxC = (deudas: any[], empresa: CompanyInfo, totalUSD: number) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Estado de Cuenta de Clientes (CxC)', empresa);

  doc.setFillColor(240, 240, 240);
  doc.rect(15, startY, 186, 10, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`SALDO TOTAL PENDIENTE POR COBRAR: ${fmt(totalUSD)}`, 20, startY + 6.5);

  autoTable(doc, {
    startY: startY + 15,
    head: [['EMISIÓN', 'VENCIMIENTO', 'CLIENTE', 'MONTO ORIGINAL', 'ABONADO', 'SALDO PENDIENTE']],
    body: deudas.map(d => [
      d.fecha,
      d.fechaVencimiento === '2099-12-31' ? 'ABIERTO' : d.fechaVencimiento,
      d.cliente.toUpperCase(),
      fmt(d.montoUSD),
      fmt(d.abonadoUSD),
      fmt(d.saldoUSD)
    ]),
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 245, 255] }
  });

  doc.save(`Estado_CxC_${new Date().getTime()}.pdf`);
};

// 9. Reporte de Cuentas por Pagar (CxP)
export const exportarPDFCxP = (deudas: any[], empresa: CompanyInfo, totalUSD: number) => {
  const doc = new jsPDF('p', 'mm', 'letter');
  const startY = drawHeader(doc, 'Compromisos de Pago a Proveedores (CxP)', empresa);

  doc.setFillColor(255, 245, 240);
  doc.rect(15, startY, 186, 10, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(150, 50, 0);
  doc.text(`DEUDA TOTAL POR LIQUIDAR: ${fmt4(totalUSD)}`, 20, startY + 6.5);

  autoTable(doc, {
    startY: startY + 15,
    head: [['FECHA', 'VENCIMIENTO', 'PROVEEDOR', 'FACTURA', 'MONTO', 'SALDO']],
    body: deudas.map(d => [
      d.fecha,
      d.fechaVencimiento,
      d.proveedor.toUpperCase(),
      d.numeroFactura || '-',
      fmt4(d.montoUSD),
      fmt4(d.saldoUSD)
    ]),
    headStyles: { fillColor: [150, 50, 0] },
    styles: { fontSize: 8 }
  });

  doc.save(`Reporte_CxP_${new Date().getTime()}.pdf`);
};

// Legacy compatibility
export const generarPDFInventario = async (products: Product[]) => {
  const doc = new jsPDF('l', 'mm', 'letter');
  autoTable(doc, {
    head: [['CÓDIGO', 'PRODUCTO', 'CATEGORÍA', 'PRECIO', 'STOCK']],
    body: products.map(p => [p.codigo, p.nombre, p.categoria, p.precioUSD, p.stock]),
  });
  doc.save('inventario.pdf');
};
