/**
 * @fileOverview Utilidades de formateo y conversión monetaria para PosVEN Pro.
 * Manejo de céntimos para evitar errores de redondeo en cálculos bimonetarios.
 */

export const formatBs = (val: number) => 
  'Bs. ' + new Intl.NumberFormat('es-VE', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 2 
  }).format(val);

export const formatUsd = (val: number) => 
  new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2 
  }).format(val);

export const formatUsdNumber = (val: number) => 
  new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(val);

export const toCentsBs = (val: number) => Math.round(val * 100);
export const toCentsUsd = (val: number) => Math.round(val * 100);
export const fromCentsBs = (cents: number) => cents / 100;
export const fromCentsUsd = (cents: number) => cents / 100;

export const parseCentsFromString = (val: string) => {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : Math.round(num * 100);
};
