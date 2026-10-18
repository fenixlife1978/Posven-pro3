'use client';
import { useState, useEffect } from 'react';
import { X, Search, CreditCard, User, UserPlus, AlertCircle } from 'lucide-react';
import { Customer, Debt } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { formatUsd } from '@/lib/currency-formatter';
import { useToast } from '@/hooks/use-toast';

// ============================================================
// UTILIDADES DE NORMALIZACIÓN DE CÉDULA (integradas)
// ============================================================

/**
 * Normaliza una cédula según el tipo de documento
 * - Para V- y E-: formato con puntos (XX.XXX.XXX)
 * - Para J-, G-, P-: solo dígitos sin formato
 */
function normalizeCedula(cedula: string, docType?: string): string {
  if (!cedula) return '';
  
  let type = docType || '';
  let number = cedula;
  
  const match = cedula.match(/^([A-Z]-?)?(.*)/);
  if (match) {
    if (match[1] && !docType) {
      type = match[1].replace('-', '').trim() + '-';
    }
    number = match[2] || '';
  }
  
  const cleanNumber = number.replace(/[^0-9]/g, '');
  
  if (!type) type = 'V-';
  
  if (type === 'V-' || type === 'E-') {
    const digits = cleanNumber;
    if (digits.length <= 2) return `${type}${digits}`;
    if (digits.length <= 5) return `${type}${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}`;
  }
  
  return `${type}${cleanNumber}`;
}

function getRawCedula(cedula: string): string {
  return (cedula || '').replace(/[^0-9]/g, '');
}

function extractDocType(cedula: string): string {
  const match = cedula.match(/^([A-Z]-?)/);
  return match ? match[1].replace('-', '').trim() + '-' : 'V-';
}

// Mayúsculas y sin tildes, para que "José" coincida con "Jose" y viceversa
function normalizeText(s: string): string {
  return (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

interface CreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (customer: Customer, amount: number) => void;
  totalAmount: number;
}

export function CreditModal({ isOpen, onClose, onConfirm, totalAmount }: CreditModalProps) {
  const { toast } = useToast();
  const [store, setStore] = useState<any>(Store.get());

  const [view, setView] = useState<'search' | 'results' | 'found' | 'create'>('search');
  const [docType, setDocType] = useState('V-');
  const [docNumber, setDocNumber] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [results, setResults] = useState<Customer[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStore(Store.get());
    const unsubscribe = Store.subscribe(setStore);
    return () => unsubscribe();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setView('search');
      setDocType('V-');
      setDocNumber('');
      setFoundCustomer(null);
      setResults([]);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
    }
  }, [isOpen]);

  const handleDocNumberChange = (value: string) => {
    // Si contiene letras, permitir entrada libre para búsqueda por nombre
    if (/[a-zA-Z]/.test(value)) {
      setDocNumber(value.toUpperCase());
    } else {
      // Si son solo números o puntuación, aplicar máscara de cédula
      const clean = value.replace(/[^0-9]/g, '');
      const formatted = normalizeCedula(clean, docType);
      setDocNumber(formatted);
    }
  };

  const handleDocTypeChange = (type: string) => {
    setDocType(type);
    if (docNumber && !/[a-zA-Z]/.test(docNumber)) {
      const cleanNumber = docNumber.replace(/[^0-9]/g, '');
      const formatted = normalizeCedula(cleanNumber, type);
      setDocNumber(formatted);
    }
  };

  // Busca clientes por cédula o nombre entre TODOS los clientes registrados
  // (con o sin deuda) y también entre las deudas CxC sin ficha de cliente.
  // Devuelve TODOS los que coinciden (puede haber varios "Rafael", por ejemplo).
  const findCustomers = (q: string, isName: boolean): Customer[] => {
    const raw = isName ? '' : getRawCedula(q);
    const customers: Customer[] = store.clientes || [];
    const deudas: Debt[] = store.cxc || [];

    // Separa nombre y cédula de un registro de deuda, tolerando el formato
    // "NOMBRE [V-123456]" y también los registros viejos sin corchetes.
    const parseDebt = (clienteRaw: string): { nombre: string; cedula: string } => {
      const m = clienteRaw.match(/^(.*?)\s*\[(.*?)\]$/);
      if (m) return { nombre: m[1], cedula: m[2] };
      return { nombre: clienteRaw, cedula: '' };
    };

    // 1. Clientes registrados que coinciden (cédula exacta ignorando formato, o nombre parcial).
    const clientesMatch = customers.filter(c =>
      isName
        ? normalizeText(c.name).includes(normalizeText(q))
        : getRawCedula(c.cedula) === raw
    );

    // 2. Deudas CxC que coinciden, para calcular el saldo y reconstruir clientes sin ficha.
    const deudasMatch = deudas.filter(d => {
      if (!d.cliente) return false;
      const { nombre, cedula } = parseDebt(d.cliente);
      if (isName) return normalizeText(nombre).includes(normalizeText(q));
      return getRawCedula(cedula) === raw;
    });

    const deudaPorCedula = new Map<string, number>();
    const deudaPorNombre = new Map<string, number>();
    deudas.forEach(d => {
      if (!d.cliente) return;
      const { nombre, cedula } = parseDebt(d.cliente);
      const ced = getRawCedula(cedula);
      const nkey = normalizeText(nombre);
      if (ced) deudaPorCedula.set(ced, (deudaPorCedula.get(ced) || 0) + (d.saldoUSD || 0));
      if (nkey) deudaPorNombre.set(nkey, (deudaPorNombre.get(nkey) || 0) + (d.saldoUSD || 0));
    });

    const seen = new Set<string>();
    const out: Customer[] = [];

    // 3. Clientes registrados (prioridad), con su saldo actual (aunque sea cero).
    clientesMatch.forEach(c => {
      const rawC = getRawCedula(c.cedula);
      const key = rawC || (c.id || '');
      if (seen.has(key)) return;
      seen.add(key);
      const debt = rawC
        ? (deudaPorCedula.get(rawC) ?? 0)
        : (deudaPorNombre.get(normalizeText(c.name)) ?? 0);
      out.push({ ...c, debt });
    });

    // 4. Clientes que solo tienen deudas CxC (sin ficha): se construyen desde la deuda.
    deudasMatch.forEach(d => {
      if (!d.cliente) return;
      const { nombre, cedula } = parseDebt(d.cliente);
      const ced = getRawCedula(cedula);
      const key = ced || `NOM-${normalizeText(nombre)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: `CUS-${Date.now()}-${out.length}`,
        name: (nombre || '').trim(),
        cedula: ced ? normalizeCedula(cedula, extractDocType(cedula)) : 'SIN DOCUMENTO',
        address: 'Sin dirección',
        phone: 'Sin teléfono',
        debt: ced ? (deudaPorCedula.get(ced) || 0) : (deudaPorNombre.get(normalizeText(nombre)) || 0)
      });
    });

    return out;
  };

  const handleSearch = () => {
    const searchStr = docNumber.trim().toUpperCase();
    if (!searchStr) {
      toast({ title: "Dato Requerido", description: "Por favor, ingrese un documento o nombre.", variant: "destructive" });
      return;
    }

    const isName = /[a-zA-Z]/.test(searchStr) && !/^[A-Z]-\d/.test(searchStr);
    const q = isName ? searchStr : `${docType}${searchStr.replace(/[^0-9]/g, '')}`;
    const matches = findCustomers(q, isName);

    if (matches.length === 1) {
      setFoundCustomer(matches[0]);
      setResults([]);
      setView('found');
    } else if (matches.length > 1) {
      setFoundCustomer(null);
      setResults(matches);
      setView('results');
    } else {
      setFoundCustomer(null);
      setResults([]);
      // Si lo buscado tiene letras, lo pre-cargamos como nombre para el registro nuevo
      if (isName) setNewName(searchStr);
      setView('create');
    }
  };

  const selectResult = (c: Customer) => {
    setFoundCustomer(c);
    setResults([]);
    setView('found');
  };

  const handleConfirmCharge = () => {
    if (foundCustomer) {
      const customers: Customer[] = store.clientes || [];
      const rawCedula = getRawCedula(foundCustomer.cedula);
      const exists = rawCedula.length > 0 && customers.some(c => getRawCedula(c.cedula) === rawCedula);
      if (!exists) {
        const cedulaNormalizada = normalizeCedula(foundCustomer.cedula, extractDocType(foundCustomer.cedula));
        const newCustomer: Customer = {
          id: `CUS-${Date.now()}`,
          name: foundCustomer.name,
          cedula: cedulaNormalizada,
          address: foundCustomer.address || 'Sin dirección',
          phone: foundCustomer.phone || 'Sin teléfono',
          debt: foundCustomer.debt || 0
        };
        const updatedCustomers = [...customers, newCustomer];
        Store.set({ clientes: updatedCustomers });
        setFoundCustomer({ ...newCustomer });
        onConfirm(newCustomer, totalAmount);
      } else {
        onConfirm(foundCustomer, totalAmount);
      }
    }
  };
  
  const handleCreateAndCharge = () => {
    const cleanDoc = docNumber.replace(/\./g, '');
    const fullDoc = `${docType}${cleanDoc}`;
    const normalizedCedula = normalizeCedula(fullDoc);
    const raw = getRawCedula(normalizedCedula);
    
    if (!newName.trim() || raw.length === 0) {
      toast({ title: "Campos Incompletos", description: "El nombre y el número de identificación son obligatorios.", variant: "destructive" });
      return;
    }

    const customers: Customer[] = store.clientes || [];
    const deudas: Debt[] = store.cxc || [];
    const exists = customers.some(c => getRawCedula(c.cedula) === raw) ||
                   deudas.some(d => {
                     if (!d.cliente) return false;
                     const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
                     return match && getRawCedula(match[2]) === raw;
                   });

    if (exists) {
      toast({ title: "Cliente ya existe", description: `Ya existe un cliente con el documento ${normalizedCedula}`, variant: "destructive" });
      return;
    }

    const newCustomer: Customer = {
      id: `CUS-${Date.now()}`,
      cedula: normalizedCedula,
      name: newName.trim().toUpperCase(),
      phone: newPhone.trim(),
      address: newAddress.trim(),
      debt: 0
    };
    
    const updatedCustomers = [...customers, newCustomer];
    Store.set({ ...store, clientes: updatedCustomers });

    toast({ title: "Cliente Creado", description: `Se ha registrado a ${newName}. Procediendo a cargar el crédito.` });
    onConfirm(newCustomer, totalAmount);
  };

  const handleBackToSearch = () => {
    setView('search');
    setFoundCustomer(null);
    setResults([]);
    setDocNumber('');
    setNewName('');
    setNewPhone('');
    setNewAddress('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4 animate-in fade-in-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-300 overflow-hidden max-h-[95vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-black shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#D4A017]" />
            <h2 className="text-base font-bold text-white uppercase tracking-tighter">Cargar Crédito a Cartera</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-white/60 hover:text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
          <div className="bg-black rounded-xl p-3 text-center shrink-0">
            <p className="text-[10px] font-bold text-white/60 uppercase">Monto total a deber</p>
            <p className="text-2xl font-black text-[#D4A017]">{formatUsd(totalAmount)}</p>
          </div>

          {view === 'search' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="doc-input" className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 ml-1">Identificación o Nombre del Cliente</label>
                <div className="flex items-center gap-2">
                  <select 
                    value={docType} 
                    onChange={e => handleDocTypeChange(e.target.value)} 
                    className="h-11 bg-gray-100 border border-gray-200 rounded-xl px-2 font-bold text-gray-700 focus:ring-2 focus:ring-[#D4A017] outline-none text-sm w-[75px]"
                  >
                    <option>V-</option> <option>E-</option> <option>J-</option> <option>G-</option> <option>P-</option>
                  </select>
                  <input
                    id="doc-input"
                    type="text"
                    value={docNumber}
                    onChange={(e) => handleDocNumberChange(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Escriba Cédula o Nombre..."
                    className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm placeholder:text-gray-300"
                    autoFocus
                  />
                  <button 
                    onClick={handleSearch} 
                    className="h-11 w-11 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center hover:bg-blue-700 transition-all shrink-0 shadow-lg shadow-blue-200"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-6 py-2 text-gray-400 font-bold hover:text-gray-600 transition-colors text-xs uppercase">Cancelar</button>
              </div>
            </div>
          )}

          {view === 'results' && (
            <div className="space-y-3 animate-in zoom-in-95 duration-200">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Se encontraron {results.length} clientes. Seleccione uno:</p>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                {results.map((c, i) => (
                  <button
                    key={c.id || i}
                    onClick={() => selectResult(c)}
                    className="w-full bg-blue-50 border border-blue-100 rounded-2xl p-4 text-left hover:border-blue-300 hover:shadow-md transition-all"
                  >
                    <p className="font-black text-sm text-blue-900 uppercase truncate">{c.name}</p>
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-[10px] text-blue-400 font-bold uppercase">ID: {c.cedula}</p>
                      <p className="text-[10px] font-black text-red-600">DEUDA: {formatUsd(c.debt || 0)}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={handleBackToSearch} className="w-full text-center text-[10px] font-black text-gray-400 uppercase hover:text-blue-600">Buscar otro cliente</button>
            </div>
          )}

          {view === 'found' && foundCustomer && (
            <div className="space-y-4 animate-in zoom-in-95 duration-200">
              <div className="bg-blue-50 rounded-2xl p-5 text-center border border-blue-100">
                <p className="text-[10px] font-black text-blue-400 uppercase mb-1">Cliente Localizado</p>
                <p className="font-black text-xl text-blue-900 uppercase">{foundCustomer.name}</p>
                <div className="h-px bg-blue-200 w-12 mx-auto my-3"></div>
                <p className="text-sm text-blue-700">
                  DEUDA ACTUAL: <span className="font-black text-red-600">{formatUsd(foundCustomer.debt || 0)}</span>
                </p>
                <p className="text-[10px] text-blue-400 font-bold mt-1 uppercase">ID: {foundCustomer.cedula}</p>
              </div>
              <button
                onClick={handleConfirmCharge}
                className="w-full h-14 bg-blue-600 text-white rounded-xl font-black text-sm hover:bg-blue-700 hover:shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
              >
                <CreditCard className="w-5 h-5" />
                Confirmar y Cargar a Cuenta
              </button>
              <button onClick={handleBackToSearch} className="w-full text-center text-[10px] font-black text-gray-400 uppercase hover:text-blue-600">Buscar otro cliente</button>
            </div>
          )}

          {view === 'create' && (
            <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <p className="font-bold text-amber-700 text-[10px] uppercase">El cliente no existe. Complete los datos para registrarlo e iniciar el crédito.</p>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-[9px] font-black text-gray-400 block mb-1 uppercase ml-1">Nombre Completo</label>
                  <input 
                    type="text" 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)} 
                    className="w-full h-10 px-4 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm uppercase" 
                    placeholder="EJ: MARIA PEREZ"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 block mb-1 uppercase ml-1">Identificación Fiscal</label>
                  <div className="flex items-center gap-2">
                    <select 
                      value={docType} 
                      onChange={e => setDocType(e.target.value)} 
                      className="h-10 bg-gray-100 border border-gray-200 rounded-xl px-2 font-bold text-gray-700 focus:ring-2 focus:ring-[#D4A017] outline-none text-sm w-[70px]"
                    >
                      <option>V-</option><option>E-</option><option>J-</option><option>G-</option><option>P-</option>
                    </select>
                    <input 
                      type="text" 
                      value={docNumber} 
                      onChange={(e) => handleDocNumberChange(e.target.value)} 
                      className="flex-1 h-10 px-4 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                      placeholder="Número de cédula..."
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black text-gray-400 block mb-1 uppercase ml-1">Teléfono</label>
                    <input 
                      type="tel" 
                      value={newPhone} 
                      onChange={e => setNewPhone(e.target.value)} 
                      className="w-full h-10 px-4 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                      placeholder="04120000000"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-gray-400 block mb-1 uppercase ml-1">Dirección</label>
                    <input 
                      type="text" 
                      value={newAddress} 
                      onChange={e => setNewAddress(e.target.value)} 
                      className="w-full h-10 px-4 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                      placeholder="Localidad..."
                    />
                  </div>
                </div>
              </div>
              <button 
                onClick={handleCreateAndCharge} 
                className="w-full h-12 bg-green-600 text-white rounded-xl font-black text-sm hover:bg-green-700 shadow-lg shadow-green-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest mt-2"
              >
                <UserPlus className="w-5 h-5" />
                Registrar y Cargar
              </button>
              <button onClick={handleBackToSearch} className="w-full text-center text-[10px] font-black text-gray-400 uppercase hover:text-blue-600 mt-1">Volver a buscar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
