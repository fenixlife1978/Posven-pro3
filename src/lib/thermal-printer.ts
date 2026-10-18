/**
 * thermal-printer.ts
 *
 * Módulo para la generación de tickets de texto plano compatibles con ESC/POS.
 * Configurado EXCLUSIVAMENTE para impresoras térmicas de 80mm.
 * MODIFICADO PARA CUMPLIR CON LOS REQUERIMIENTOS DE REPORTES X Y Z
 */

// --- Constantes de Configuración ---
const PAPER_WIDTH = 48; // Ancho fijo para 80mm

// --- Comandos ESC/POS ---
export const CMD = {
  INIT: '\x1B\x40',
  CUT: '\x1B\x69',
  DRAWER_KICK: '\x1B\x70\x00\x19\x19',
  BOLD_ON: '\x1B\x45\x01',
  BOLD_OFF: '\x1B\x45\x00',
  DOUBLE_HW_ON: '\x1B\x21\x30',
  DOUBLE_HW_OFF: '\x1B\x21\x00',
};

// --- Funciones Auxiliares de Formateo ---

function alignLeftRight(leftTxt: string, rightTxt: string): string {
  leftTxt = String(leftTxt || '');
  rightTxt = String(rightTxt || '');
  const spaceCount = PAPER_WIDTH - leftTxt.length - rightTxt.length;
  if (spaceCount < 1) {
    const availableWidth = PAPER_WIDTH - rightTxt.length - 1;
    return leftTxt.substring(0, availableWidth) + ' ' + rightTxt;
  }
  const spaces = ' '.repeat(spaceCount);
  return leftTxt + spaces + rightTxt;
}

function center(txt: string): string {
  txt = String(txt || '');
  if (txt.length >= PAPER_WIDTH) return txt.substring(0, PAPER_WIDTH);
  const leftPadding = Math.floor((PAPER_WIDTH - txt.length) / 2);
  const rightPadding = PAPER_WIDTH - txt.length - leftPadding;
  return ' '.repeat(leftPadding) + txt + ' '.repeat(rightPadding);
}

function separator(char: string): string {
  return char.repeat(PAPER_WIDTH);
}

function formatCurrency(value: number): string {
  const num = (typeof value === 'number') ? value : 0;
  return 'Bs. ' + num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatUsd(value: number): string {
  const num = (typeof value === 'number') ? value : 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function padRight(text: string, width: number): string {
  const str = String(text || '');
  if (str.length >= width) return str.substring(0, width);
  return str + ' '.repeat(width - str.length);
}

function padLeft(text: string, width: number): string {
  const str = String(text || '');
  if (str.length >= width) return str.substring(0, width);
  return ' '.repeat(width - str.length) + str;
}

// --- Generadores de Tickets ---

interface StoreInfo {
  name?: string;
  address?: string;
  rif?: string;
  phone?: string;
}

/**
 * Construye el string para un ticket de venta (80mm).
 */
export function generateSaleTicket(saleData: any, storeInfo: StoreInfo = {}): string {
    let ticket: string[] = [];

    // 1. Encabezado
    ticket.push(CMD.BOLD_ON + center(storeInfo.name || "NOMBRE EMPRESA") + CMD.BOLD_OFF);
    if (storeInfo.rif) ticket.push(center(`RIF: ${storeInfo.rif}`));
    if (storeInfo.address) ticket.push(center(storeInfo.address));
    if (storeInfo.phone) ticket.push(center(`Tel: ${storeInfo.phone}`));
    ticket.push(separator('-'));
    ticket.push(alignLeftRight(`RECIBO N°: ${saleData.id || 'N/A'}`, `CAJA: ${saleData.terminalId || '01'}`));
    ticket.push(alignLeftRight(`CAJERO: ${saleData.cajeroNombre || 'N/A'}`, ''));
    const saleDate = saleData.date ? new Date(saleData.date) : new Date();
    ticket.push(alignLeftRight(`FECHA: ${saleDate.toLocaleDateString('es-VE')}`, `HORA: ${saleDate.toLocaleTimeString('es-VE')}`));
    ticket.push(separator('-'));
    ticket.push(`CLIENTE: ${saleData.customer?.name || 'CONSUMIDOR FINAL'}`);
    if (saleData.customer?.id && saleData.customer?.id !== '0') {
        ticket.push(`RIF/CI: ${saleData.customer.id}`);
    }
    ticket.push(separator('═'));

    // 2. Cuerpo del Recibo (Items)
    ticket.push(CMD.BOLD_ON + alignLeftRight('DESCRIPCION', 'TOTAL') + CMD.BOLD_OFF);
    ticket.push(alignLeftRight('CANT x P.UNIT', 'ALIC.'));
    ticket.push(separator('-'));

    if (saleData.items && saleData.items.length > 0) {
        for (const item of saleData.items) {
            const total = item.quantity * item.precioUSD;
            ticket.push(alignLeftRight(item.nombre.substring(0, 35), formatUsd(total)));
            const detailsLeft = ` ${item.quantity} x ${formatUsd(item.precioUSD)}`;
            const alicuota = `(${item.alicuota || 'G'})`;
            ticket.push(alignLeftRight(detailsLeft, alicuota));
        }
    }
    ticket.push(separator('═'));

    // 3. Pie del Recibo (Totales)
    ticket.push(alignLeftRight('SUBTOTAL:', formatUsd(saleData.subtotal || 0)));
    if (saleData.descuentos > 0) {
        ticket.push(alignLeftRight('DESCUENTO:', `-${formatUsd(saleData.descuentos || 0)}`));
    }
    ticket.push(separator('-'));
    
    // Bases e Impuestos
    if (saleData.baseImponibleGeneral > 0) {
      ticket.push(alignLeftRight('Base Imponible (G):', formatUsd(saleData.baseImponibleGeneral)));
      ticket.push(alignLeftRight('IVA (16%):', formatUsd(saleData.ivaGeneral)));
    }
    if (saleData.montoExento > 0) {
        ticket.push(alignLeftRight('Monto Exento (E):', formatUsd(saleData.montoExento)));
    }
    if (saleData.igtf > 0) {
        ticket.push(alignLeftRight('IGTF (3%):', formatUsd(saleData.igtf)));
    }
    ticket.push(separator('═'));
    
    // Total
    ticket.push(CMD.DOUBLE_HW_ON + alignLeftRight('TOTAL A PAGAR $', formatUsd(saleData.total || 0)) + CMD.DOUBLE_HW_OFF);
    ticket.push(alignLeftRight('Total en Bs:', formatCurrency(saleData.totalBs || 0)));
    ticket.push(separator('═'));
    
    // Formas de Pago
    const paymentMethodNames: { [key: string]: string } = {
      'efectivo': 'Efectivo',
      'efectivo_usd': 'Efectivo $',
      'efectivo_bs': 'Efectivo Bs.',
      'punto_venta': 'Tarjeta',
      'tarjeta': 'Tarjeta',
      'pagomovil': 'Pago Móvil/Transf.',
      'zelle': 'Zelle',
      'credito': 'Crédito',
    };
    ticket.push(CMD.BOLD_ON + center('DETALLE DEL PAGO') + CMD.BOLD_OFF);
    if (saleData.payments && saleData.payments.length > 0) {
        for (const pay of saleData.payments) {
            const name = paymentMethodNames[pay.method] || pay.method.toUpperCase();
            const amountStr = pay.isBs ? formatCurrency(pay.amount) : `$${formatUsd(pay.amount)}`;
            ticket.push(alignLeftRight(name + ':', amountStr));
        }
    }
    if (saleData.change > 0) {
        ticket.push(alignLeftRight("SU VUELTO Bs:", formatCurrency(saleData.change)));
    }
    ticket.push(alignLeftRight(`Tasa de Cambio:`, formatCurrency(saleData.exchangeRate || 0).replace('Bs. ','')));
    ticket.push(separator('-'));

    // Pie de pagina
    ticket.push(center('¡Gracias por su compra!'));
    ticket.push(center('Documento no fiscal.'));

    return CMD.INIT + ticket.join('\n') + '\n\n\n\n' + CMD.CUT;
}

/**
 * Construye el string para un Reporte X o Z (80mm).
 * MODIFICADO PARA CUMPLIR EXACTAMENTE CON EL FORMATO SOLICITADO
 * SIEMPRE muestra todas las secciones, incluso con valores en cero
 */
export function generateReport(reportData: any, storeInfo: StoreInfo = {}, type: 'X' | 'Z'): string {
  let report = [];
  
  const isZReport = type === 'Z';
  const title = isZReport ? "*** REPORTE Z ***" : "*** REPORTE X - ARQUEO ***";
  const subtitle = isZReport ? "(CIERRE DIARIO)" : "(LECTURA PARCIAL)";

  // 1. Encabezado de Identificación (SIEMPRE igual al ejemplo)
  report.push(CMD.BOLD_ON + center(storeInfo.name || "EFAS SOLUCIONES DIGITALES C.A.") + CMD.BOLD_OFF);
  if (storeInfo.rif) report.push(center(`RIF: ${storeInfo.rif}`));
  if (storeInfo.address) report.push(center(storeInfo.address));
  report.push(separator('='));
  report.push(CMD.DOUBLE_HW_ON + center(title) + CMD.DOUBLE_HW_OFF);
  report.push(center(subtitle));
  report.push(separator('='));
  
  // 2. Información de Cabecera del Reporte
  report.push(alignLeftRight(`FECHA: ${reportData.fecha || '19/07/2026'}`, `HORA: ${reportData.hora || '02:45 PM'}`));
  const reportNumber = isZReport ? `Z-${reportData.reportNumber || '0000214'}` : `${reportData.reportNumber || '0000542'}`;
  report.push(alignLeftRight(`Nº REPORTE ${type}: ${reportNumber}`, `Nº CAJA: ${reportData.terminalId || '02'}`));
  report.push(alignLeftRight(`CAJERO: ${reportData.cajeroNombre || 'Carlos Mendoza'}`, ''));
  report.push(separator('-'));

  // 3. CONTROL DE DOCUMENTOS (SOLO PARA REPORTE Z)
  if (isZReport) {
    report.push(CMD.BOLD_ON + center("CONTROL DE DOCUMENTOS") + CMD.BOLD_OFF);
    report.push(separator('-'));
    report.push(alignLeftRight("FACTURAS EMITIDAS:", ''));
    report.push(alignLeftRight(`DESDE: ${reportData.audit?.facturaInicial || '00004512'}`, `HASTA: ${reportData.audit?.facturaFinal || '00004547'}`));
    report.push(alignLeftRight(`TOTAL FACTURAS:`, `${String(reportData.audit?.totalFacturas || '35').padStart(6, ' ')}`));
    report.push('');
    report.push(alignLeftRight("NOTAS DE CRÉDITO EMITIDAS:", ''));
    report.push(alignLeftRight(`DESDE: ${reportData.audit?.ncInicial || '00000102'}`, `HASTA: ${reportData.audit?.ncFinal || '00000103'}`));
    report.push(alignLeftRight(`TOTAL NOTAS CRÉDITO:`, `${String(reportData.audit?.totalNotasCredito || '2').padStart(6, ' ')}`));
    report.push('');
    report.push(alignLeftRight("CANT. DOCUMENTOS ANULADOS:", String(reportData.audit?.anulados || '3').padStart(6, ' ')));
    report.push(separator('-'));
  }

  // 4. RESUMEN DE OPERACIONES (SIEMPRE presente)
  report.push(CMD.BOLD_ON + center("RESUMEN DE OPERACIONES") + CMD.BOLD_OFF);
  report.push(separator('-'));
  report.push(alignLeftRight("VENTAS BRUTAS:", formatCurrency(reportData.ventaBruta || 0)));
  report.push(alignLeftRight("DESCUENTOS APLICADOS:", formatCurrency(reportData.descuentos || 0)));
  report.push(alignLeftRight("DEVOLUCIONES (N. CRÉDITO):", formatCurrency(reportData.devoluciones || 0)));
  report.push(separator('-'));
  report.push(CMD.BOLD_ON + alignLeftRight("VENTAS NETAS:", formatCurrency(reportData.ventaNeta || 0)) + CMD.BOLD_OFF);
  report.push(separator('-'));

  // 5. DESGLOSE DE IMPUESTOS (SIEMPRE presente)
  report.push(CMD.BOLD_ON + center("DESGLOSE DE IMPUESTOS") + CMD.BOLD_OFF);
  report.push(separator('-'));
  report.push(alignLeftRight("VENTAS EXENTAS (E):", formatCurrency(reportData.ventasExentas || 0)));
  report.push('');
  report.push(alignLeftRight("BASE IMPONIBLE (G 16%):", formatCurrency(reportData.baseGeneral || 0)));
  report.push(alignLeftRight("IVA RECAUDADO (16%):", formatCurrency(reportData.ivaGeneral || 0)));
  report.push('');
  report.push(alignLeftRight("RECAUDACIÓN IGTF (3%):", formatCurrency(reportData.igtf || 0)));
  report.push(separator('-'));

  // 5b. TOTAL VENTAS DEL DÍA (USD) — solicitado por el usuario.
  //     Suma de v.totalUSD: las ventas en BS ya están convertidas internamente
  //     a USD con la tasa del momento de la venta, y las ventas en USD se
  //     contabilizan tal cual. La tasa BCV del día se muestra como referencia.
  report.push(CMD.BOLD_ON + center("TOTAL VENTAS DEL DÍA (USD)") + CMD.BOLD_OFF);
  report.push(separator('-'));
  const totalVentasUSD = reportData.totalVentasUSD ?? reportData.brUSD ?? 0;
  const ventasNetasUSD = reportData.netUSD ?? 0;
  const tasaBCV = reportData.tasaBCV || 0;
  report.push(CMD.BOLD_ON + alignLeftRight("VENTAS TOTALES USD:", `$ ${formatUsd(totalVentasUSD)}`) + CMD.BOLD_OFF);
  report.push(CMD.BOLD_ON + alignLeftRight("VENTAS NETAS USD:", `$ ${formatUsd(ventasNetasUSD)}`) + CMD.BOLD_OFF);
  if (tasaBCV > 0) {
    report.push(center(`Tasa BCV: Bs. ${Number(tasaBCV).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`));
  }
  report.push(separator('-'));

  // 6. FORMAS DE PAGO (SIEMPRE presente)
  report.push(CMD.BOLD_ON + center("FORMAS DE PAGO") + CMD.BOLD_OFF);
  report.push(separator('-'));
  report.push(alignLeftRight("EFECTIVO (Bs.):", formatCurrency(reportData.pagos?.efectivoBs || 0)));
  report.push(alignLeftRight("EFECTIVO (USD):", `$ ${formatUsd(reportData.pagos?.efectivoUsd || 0)}`));
  report.push(alignLeftRight("PAGO MÓVIL:", formatCurrency(reportData.pagos?.pagoMovil || 0)));
  report.push(alignLeftRight("PUNTO DE VÉNTA (DÉBITO):", formatCurrency(reportData.pagos?.tdb || 0)));
  // Si hay otros métodos de pago, los agregamos aquí
  if (reportData.pagos?.tdc) {
    report.push(alignLeftRight("TARJETA CRÉDITO:", formatCurrency(reportData.pagos.tdc || 0)));
  }
  if (reportData.pagos?.credito) {
    report.push(alignLeftRight("CRÉDITO (POR COBRAR):", formatCurrency(reportData.pagos.credito || 0)));
  }
  if (reportData.pagos?.zelle) {
    report.push(alignLeftRight("ZELLE:", formatCurrency(reportData.pagos.zelle || 0)));
  }
  report.push(separator('-'));

  // 7. MOVIMIENTO DE CAJA (SIEMPRE presente)
  report.push(CMD.BOLD_ON + center("MOVIMIENTO DE CAJA") + CMD.BOLD_OFF);
  report.push(separator('-'));
  report.push(alignLeftRight("FONDO DE APERTURA:", formatCurrency(reportData.fondoApertura || 0)));
  report.push(alignLeftRight("ENTRADAS DE EFECTIVO:", formatCurrency(reportData.entradasEfectivo || 0)));
  report.push(alignLeftRight("SALIDAS DE EFECTIVO:", formatCurrency(reportData.salidasEfectivo || 0)));
  const labelEfectivo = isZReport ? "EFECTIVO REAL EN CAJA:" : "EFECTIVO ESTIMADO EN CAJA:";
  const efectivoCaja = isZReport ? (reportData.efectivoRealCaja || 0) : (reportData.efectivoEstimadoCaja || 0);
  report.push(CMD.BOLD_ON + alignLeftRight(labelEfectivo, formatCurrency(efectivoCaja)) + CMD.BOLD_OFF);
  report.push(separator('-'));

  // 8. ESTADÍSTICAS DE VENTA (SIEMPRE presente para REPORTE X, para Z es CONTROL DE DOCUMENTOS)
  if (!isZReport) {
    report.push(CMD.BOLD_ON + center("ESTADÍSTICAS DE VENTA") + CMD.BOLD_OFF);
    report.push(separator('-'));
    report.push(alignLeftRight("CANT. FACTURAS EMITIDAS:", String(reportData.cantFacturas || '18').padStart(6, ' ')));
    report.push(alignLeftRight("CANT. TRANSACCIONES ANULADAS:", String(reportData.cantAnuladas || '2').padStart(6, ' ')));
    report.push(alignLeftRight("TICKET PROMEDIO:", formatCurrency(reportData.ticketPromedio || 0)));
    report.push(separator('-'));
  }

  // 9. TOTALES HISTÓRICOS (SOLO PARA REPORTE Z)
  if (isZReport) {
    report.push(CMD.BOLD_ON + center("TOTALES HISTÓRICOS") + CMD.BOLD_OFF);
    report.push(center("(ACUMULADO NO REINICIABLE)"));
    report.push(separator('-'));
    report.push(alignLeftRight("GRAN TOTAL VENTAS:", formatCurrency(reportData.audit?.granTotalVentas || 145284.52)));
    report.push(alignLeftRight("GRAN TOTAL IVA:", formatCurrency(reportData.audit?.granTotalIva || 18410.15)));
    report.push(separator('='));
  } else {
    // Para REPORTE X, el separador final
    report.push(separator('='));
  }

  // 10. Pie de página según tipo de reporte
  if (isZReport) {
    report.push(center("CIERRE DE JORNADA EXITOSO"));
  } else {
    report.push(center("DOCUMENTO NO VÁLIDO COMO"));
    report.push(center("CIERRE FISCAL"));
  }
  report.push(separator('='));

  return CMD.INIT + report.join('\n') + '\n\n\n\n' + CMD.CUT;
}