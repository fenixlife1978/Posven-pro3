// src/lib/cedula-utils.ts

/**
 * Normaliza una cédula según el tipo de documento
 * - Para V- y E-: formato con puntos (XX.XXX.XXX)
 * - Para J-, G-, P-: solo dígitos sin formato
 */
export function normalizeCedula(cedula: string, docType?: string): string {
    if (!cedula) return '';
    
    // Si viene con tipo (ej: "V-13.313.521"), extraer tipo y número
    let type = docType || '';
    let number = cedula;
    
    const match = cedula.match(/^([A-Z]-?)?(.*)/);
    if (match) {
      if (match[1] && !docType) {
        type = match[1].replace('-', '').trim() + '-';
      }
      number = match[2] || '';
    }
    
    // Limpiar puntos y otros caracteres no numéricos
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Si no hay tipo definido, intentar detectar
    if (!type) {
      // Por defecto asumimos V- si no se especifica
      type = 'V-';
    }
    
    // Para V- y E- aplicar formato con puntos
    if (type === 'V-' || type === 'E-') {
      const digits = cleanNumber;
      if (digits.length <= 2) return `${type}${digits}`;
      if (digits.length <= 5) return `${type}${digits.slice(0, 2)}.${digits.slice(2)}`;
      if (digits.length <= 8) return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
      return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}`;
    }
    
    // Para J-, G-, P-: solo dígitos
    return `${type}${cleanNumber}`;
  }
  
  /**
   * Obtiene solo el número de cédula sin puntos ni tipo
   */
  export function getRawCedula(cedula: string): string {
    return cedula.replace(/[^0-9]/g, '');
  }
  
  /**
   * Compara dos cédulas ignorando formato y tipo
   * Retorna true si el número (sin tipo) coincide
   */
  export function sameCedula(cedula1: string, cedula2: string): boolean {
    return getRawCedula(cedula1) === getRawCedula(cedula2);
  }
  
  /**
   * Extrae el tipo de documento (V-, J-, etc.) de una cédula
   */
  export function extractDocType(cedula: string): string {
    const match = cedula.match(/^([A-Z]-?)/);
    return match ? match[1].replace('-', '').trim() + '-' : 'V-';
  }
  
  /**
   * Busca un cliente por cédula normalizada, ignorando formato
   */
  export function findCustomerByCedula(customers: any[], cedula: string): any | null {
    const raw = getRawCedula(cedula);
    return customers.find(c => getRawCedula(c.cedula) === raw) || null;
  }
  
  /**
   * Busca una deuda por cédula del cliente (en el campo cliente)
   */
  export function findDebtsByCedula(deudas: any[], cedula: string): any[] {
    const raw = getRawCedula(cedula);
    return deudas.filter(d => {
      if (!d.cliente) return false;
      const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
      if (match) {
        return getRawCedula(match[2]) === raw;
      }
      return false;
    });
  }