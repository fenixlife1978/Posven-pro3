'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Debt, Customer } from '@/lib/types';
import { Utils, Store } from '@/lib/db-store';
import { 
  Plus, 
  X, 
  Save, 
  HandCoins, 
  Calendar, 
  CheckSquare, 
  Square, 
  Eye, 
  Trash2, 
  Clock, 
  ClipboardList, 
  Box, 
  FileText,
  ChevronDown,
  ChevronUp,
  User,
  Contact,
  Receipt,
  BookOpen,
  Hash,
  Phone,
  MapPin
} from 'lucide-react';
import { exportarPDFCxC } from '@/lib/pdf-generator';
import { useToast } from '@/hooks/use-toast';
import { Pagination } from '@/components/ui/pagination';

export default function CxCModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const { toast } = useToast();
  useEffect(() => { Store.ensureLoaded('ventas'); }, []);
  const [showModal, setShowModal] = useState(false);
  const [showDetails, setShowDetails] = useState<any>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showClientHistory, setShowClientHistory] = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<'todos' | 'pendiente' | 'pagada' | 'parcial'>('todos');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [filterEstado]);

  const [nuevaDeuda, setNuevaDeuda] = useState({
    cliente: '',
    tipoDoc: 'V',
    cedula: '',
    telefono: '',
    direccion: '',
    montoUSD: 0,
    fecha: Utils.hoy(),
    vencimiento: Utils.hoy(),
    sinVencimiento: false
  });

  const formatCedula = (val: string) => {
    const digits = val.replace(/\D/g, '');
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const handleCedulaChange = (val: string) => {
    setNuevaDeuda({ ...nuevaDeuda, cedula: formatCedula(val) });
  };

  const formatTelefono = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    return digits.slice(0, 4) + '-' + digits.slice(4, 11);
  };

  const handleTelefonoChange = (val: string) => {
    setNuevaDeuda({ ...nuevaDeuda, telefono: formatTelefono(val) });
  };

  // Obtener TODOS los clientes del sistema
  const allCustomers: Customer[] = state.clientes || [];
  
  // Todas las deudas (incluyendo pagadas)
  const todasLasDeudas = state.cxc || [];
  
  // Deudas pendientes (no pagadas) para el total
  const pendientes = todasLasDeudas.filter((x: any) => x.estado !== 'pagada');
  const totalPendiente = pendientes.reduce((s: number, x: any) => s + x.saldoUSD, 0);

  // Agrupar SOLO clientes que existen en state.clientes
  const groupedCredits = useMemo(() => {
    const groups: Record<string, { 
      totalUSD: number; 
      debts: Debt[];
      customer: Customer;
    }> = {};

    // 1. Primero, agregar todos los clientes del sistema
    allCustomers.forEach((customer: Customer) => {
      groups[customer.name] = { 
        totalUSD: 0, 
        debts: [],
        customer: customer
      };
    });

    // 2. Luego, agregar las deudas de esos clientes
    todasLasDeudas.forEach((debt: Debt) => {
      // Extraer solo el nombre del cliente de la deuda (sin el [V-123456])
      const nombreCliente = debt.cliente ? debt.cliente.split(' [')[0] : 'DESCONOCIDO';
      
      // Buscar el cliente en los grupos
      const customerKey = Object.keys(groups).find(key => key === nombreCliente);
      
      if (customerKey) {
        groups[customerKey].debts.push(debt);
        // Solo sumar al total si la deuda no está pagada
        if (debt.estado !== 'pagada') {
          groups[customerKey].totalUSD += debt.saldoUSD;
        }
      }
    });

    // Ordenar los grupos por nombre
    const sortedGroups: Record<string, any> = {};
    Object.keys(groups).sort().forEach(key => {
      groups[key].debts.sort((a: Debt, b: Debt) => a.fecha.localeCompare(b.fecha));
      sortedGroups[key] = groups[key];
    });

    // Filtrar por estado si es necesario
    if (filterEstado !== 'todos') {
      const filteredGroups: Record<string, any> = {};
      Object.keys(sortedGroups).forEach(name => {
        const group = sortedGroups[name];
        const filteredDebts = group.debts.filter((d: Debt) => d.estado === filterEstado);
        if (filteredDebts.length > 0) {
          filteredGroups[name] = {
            ...group,
            debts: filteredDebts,
            totalUSD: filteredDebts.reduce((s: number, d: Debt) => s + (d.estado !== 'pagada' ? d.saldoUSD : 0), 0)
          };
        }
        // Los clientes sin deudas no se muestran cuando hay filtro activo
      });
      return filteredGroups;
    }

    // Cuando filterEstado === 'todos', devolvemos todos los grupos
    return sortedGroups;
  }, [todasLasDeudas, allCustomers, filterEstado]);

  const creditEntries = Object.entries(groupedCredits);
  const creditTotalPages = Math.max(1, Math.ceil(creditEntries.length / pageSize));
  const creditSafePage = Math.min(page, creditTotalPages);
  const pageCreditEntries = creditEntries.slice((creditSafePage - 1) * pageSize, creditSafePage * pageSize);

  // ===== ELIMINAR CLIENTE COMPLETO =====
  const eliminarCliente = (clientName: string) => {
    // Verificar si el cliente tiene deudas pendientes
    const tieneDeudasPendientes = todasLasDeudas.some(
      (d: Debt) => {
        const nombreCliente = d.cliente ? d.cliente.split(' [')[0] : '';
        return nombreCliente === clientName && d.estado !== 'pagada';
      }
    );
    
    if (tieneDeudasPendientes) {
      toast({ 
        variant: "destructive",
        title: "No se puede eliminar", 
        description: `El cliente "${clientName}" tiene deudas pendientes.` 
      });
      return;
    }

    // Verificar si el cliente tiene deudas (aunque estén pagadas)
    const tieneDeudas = todasLasDeudas.some(
      (d: Debt) => {
        const nombreCliente = d.cliente ? d.cliente.split(' [')[0] : '';
        return nombreCliente === clientName;
      }
    );
    
    let mensajeConfirmacion = `¿Está seguro de eliminar permanentemente al cliente "${clientName}"`;
    if (tieneDeudas) {
      mensajeConfirmacion += " y todo su historial de deudas (pagadas)";
    }
    mensajeConfirmacion += "?";

    if (!confirm(mensajeConfirmacion)) {
      return;
    }

    // Eliminar cliente de la lista de clientes
    const clientesActualizados = allCustomers.filter((c: Customer) => c.name !== clientName);
    
    // Eliminar todas las deudas del cliente
    const deudasActualizadas = todasLasDeudas.filter((d: Debt) => {
      const nombreCliente = d.cliente ? d.cliente.split(' [')[0] : '';
      return nombreCliente !== clientName;
    });
    
    updateState({ 
      clientes: clientesActualizados, 
      cxc: deudasActualizadas 
    });
    
    toast({ 
      title: "Cliente eliminado", 
      description: `El cliente "${clientName}" ha sido eliminado permanentemente.` 
    });
  };

  const guardarDeudaDirecta = () => {
    if (!nuevaDeuda.cliente || !nuevaDeuda.cedula || nuevaDeuda.montoUSD <= 0) {
      alert('Por favor ingrese el cliente, su cédula y un monto válido.');
      return;
    }

    const idFull = `${nuevaDeuda.tipoDoc}-${nuevaDeuda.cedula}`;
    const nombreFull = `${nuevaDeuda.cliente} [${idFull}]`;

    // Verificar si el cliente ya existe en la lista de clientes
    const clienteExistente = allCustomers.find((c: Customer) => c.name === nuevaDeuda.cliente);
    
    if (!clienteExistente) {
      // Crear nuevo cliente con teléfono y dirección
      const nuevoCliente: Customer = {
        id: `CUS-${Date.now()}`,
        name: nuevaDeuda.cliente,
        cedula: idFull,
        address: nuevaDeuda.direccion || 'Sin dirección',
        phone: nuevaDeuda.telefono || 'Sin teléfono',
        debt: nuevaDeuda.montoUSD
      };
      updateState({ clientes: [...allCustomers, nuevoCliente] });
    } else {
      // Actualizar datos del cliente existente (teléfono y dirección)
      const updatedCustomers = allCustomers.map((c: Customer) => 
        c.id === clienteExistente.id ? { 
          ...c, 
          debt: (c.debt || 0) + nuevaDeuda.montoUSD,
          address: nuevaDeuda.direccion || c.address || 'Sin dirección',
          phone: nuevaDeuda.telefono || c.phone || 'Sin teléfono'
        } : c
      );
      updateState({ clientes: updatedCustomers });
    }

    const nuevaEntrada: Debt = {
      id: 'DEU-' + Store.uid().toUpperCase().slice(0, 6),
      fecha: nuevaDeuda.fecha,
      fechaVencimiento: nuevaDeuda.sinVencimiento ? '2099-12-31' : nuevaDeuda.vencimiento,
      cliente: nombreFull,
      montoUSD: nuevaDeuda.montoUSD,
      abonadoUSD: 0,
      saldoUSD: nuevaDeuda.montoUSD,
      estado: 'pendiente' as 'pendiente',
      historialPagos: []
    };
    updateState({ cxc: [...state.cxc, nuevaEntrada] });
    setShowModal(false);
    setNuevaDeuda({ 
      cliente: '', 
      tipoDoc: 'V', 
      cedula: '', 
      telefono: '',
      direccion: '',
      montoUSD: 0, 
      fecha: Utils.hoy(), 
      vencimiento: Utils.hoy(), 
      sinVencimiento: false 
    });
  };

  const eliminarDeuda = (deuda: any) => {
    if (!confirm(`¿Seguro que desea eliminar el registro ${deuda.id}? Esta acción no se puede deshacer.`)) return;
    const nuevas = state.cxc.filter((x: Debt) => x.id !== deuda.id);
    
    // Actualizar deuda del cliente
    const clientesActualizados = allCustomers.map((c: Customer) => {
      if (c.name === deuda.cliente || c.cedula === deuda.cliente) {
        return { ...c, debt: Math.max(0, (c.debt || 0) - deuda.saldoUSD) };
      }
      return c;
    });
    
    updateState({ cxc: nuevas, clientes: clientesActualizados });
  };

  const handleExportPDF = () => {
    exportarPDFCxC(pendientes, state.empresa, totalPendiente);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <HandCoins className="text-brand-gold w-7 h-7" /> COBRANZAS (GESTIÓN GLOBAL)
          </h2>
          <p className="text-[10px] text-ink font-black uppercase tracking-widest">Seguimiento de Cartera de Clientes y Morosidad</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExportPDF} className="btn btn-secondary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-md">
            <FileText className="w-4 h-4" /> Reporte CxC
          </button>
          <button onClick={() => setShowModal(true)} className="btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-lg">
            <Plus className="w-4 h-4" /> Cargar Deuda Inicial
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-line shadow-sm flex-wrap">
        <span className="text-[10px] font-black uppercase text-ink">Filtrar por estado:</span>
        <div className="flex gap-2 flex-wrap">
          {['todos', 'pendiente', 'parcial', 'pagada'].map(estado => (
            <button
              key={estado}
              onClick={() => setFilterEstado(estado as any)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                filterEstado === estado 
                  ? 'bg-brand-gold text-black shadow-md' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {estado === 'todos' ? 'Todos' : estado}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl flex items-center gap-4">
           <div className="p-3 bg-ink text-brand-gold rounded-xl"><ClipboardList /></div>
           <div>
              <div className="text-ink text-[10px] font-black uppercase mb-0.5">Total Clientes</div>
              <div className="text-3xl font-black text-ink">{Object.keys(groupedCredits).length}</div>
           </div>
        </div>
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl flex items-center gap-4">
           <div className="p-3 bg-ink text-brand-gold rounded-xl"><Clock /></div>
           <div>
              <div className="text-ink text-[10px] font-black uppercase mb-0.5">Clientes con Deuda</div>
              <div className="text-3xl font-black text-ink">
                {Object.keys(groupedCredits).filter(name => groupedCredits[name].totalUSD > 0).length}
              </div>
           </div>
        </div>
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl border-l-[6px] border-l-status-danger">
          <div className="text-ink text-[10px] font-black uppercase mb-1">Total Por Cobrar (Cartera Activa)</div>
          <div className="text-4xl font-black text-status-danger">{Utils.fmtUSD(totalPendiente)}</div>
          <div className="text-ink text-sm font-black mt-1 italic">{Utils.fmtBS(totalPendiente * state.tasa)}</div>
        </div>
      </div>

      <div className="card shadow-xl border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-gold" /> LISTADO CONSOLIDADO POR CLIENTE
          </h3>
          <span className="text-white/40 text-[10px] font-black uppercase">
            {Object.keys(groupedCredits).length} clientes totales
          </span>
        </div>
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-soft">
                <th className="px-6 py-3"></th>
                <th className="text-ink font-black text-[10px] uppercase">Cliente / Identificación</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Documentos</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Saldo USD</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Saldo BS</th>
                <th className="text-ink font-black text-[10px] uppercase text-center">Estado</th>
                <th className="text-ink font-black text-[10px] uppercase text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedCredits).length === 0 ? (
                <tr><td colSpan={7} className="text-center py-20 text-ink font-black uppercase italic">No hay clientes registrados</td></tr>
              ) : (
                pageCreditEntries.map(([clientName, group]) => {
                  const tieneDeudaPendiente = group.totalUSD > 0;
                  const tieneDeudas = group.debts.length > 0;
                  
                  return (
                    <React.Fragment key={clientName}>
                      <tr className={`border-b border-line hover:bg-surface-warm/20 transition-colors ${!tieneDeudaPendiente && tieneDeudas ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4">
                           {tieneDeudas ? (
                             <button onClick={() => setExpandedClient(expandedClient === clientName ? null : clientName)} className="text-brand-gold hover:scale-110 transition-transform">
                                {expandedClient === clientName ? <ChevronUp /> : <ChevronDown />}
                             </button>
                           ) : (
                             <span className="text-gray-300">-</span>
                           )}
                        </td>
                        <td className="py-4">
                           <div className="text-ink font-black text-sm uppercase">{clientName}</div>
                           <div className="text-[10px] text-ink font-black uppercase tracking-widest">
                             {group.customer?.cedula ? `ID: ${group.customer.cedula}` : 'SIN IDENTIFICACIÓN'}
                           </div>
                           <div className="text-[9px] text-ink/60 font-black uppercase">
                             {group.customer?.phone && group.customer.phone !== 'Sin teléfono' ? `📞 ${group.customer.phone}` : ''}
                           </div>
                        </td>
                        <td className="text-right py-4 font-black text-ink">{group.debts.length} Facturas</td>
                        <td className={`text-right py-4 font-black text-base ${tieneDeudaPendiente ? 'text-status-info' : 'text-green-600'}`}>
                          {Utils.fmtUSD(group.totalUSD)}
                        </td>
                        <td className="text-right py-4 font-black text-ink">{Utils.fmtBS(group.totalUSD * state.tasa)}</td>
                        <td className="text-center py-4">
                          {tieneDeudaPendiente ? (
                            <span className="badge badge-warn font-black text-[8px] uppercase px-3">Con Deuda</span>
                          ) : group.debts.length > 0 ? (
                            <span className="badge badge-ok font-black text-[8px] uppercase px-3">Pagado</span>
                          ) : (
                            <span className="badge badge-info font-black text-[8px] uppercase px-3">Sin Deudas</span>
                          )}
                        </td>
                        <td className="text-center py-4">
                           <div className="flex items-center justify-center gap-2">
                             {tieneDeudas ? (
                               <>
                                 <button 
                                   onClick={() => setShowClientHistory(clientName)} 
                                   className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"
                                   title="Consultar Historial Maestro"
                                 >
                                   <Eye className="w-5 h-5" />
                                 </button>
                                 {/* ===== BOTÓN ELIMINAR CLIENTE - SOLO SI NO TIENE DEUDAS PENDIENTES ===== */}
                                 {!tieneDeudaPendiente && (
                                   <button 
                                     onClick={() => eliminarCliente(clientName)} 
                                     className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-danger border-2 border-status-danger/20 hover:bg-status-danger hover:text-white transition-all shadow-md"
                                     title="Eliminar Cliente"
                                   >
                                     <Trash2 className="w-5 h-5" />
                                   </button>
                                 )}
                               </>
                             ) : (
                               /* ===== CLIENTE SIN DEUDAS - MOSTRAR PAPELERA DIRECTAMENTE ===== */
                               <button 
                                 onClick={() => eliminarCliente(clientName)} 
                                 className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-danger border-2 border-status-danger/20 hover:bg-status-danger hover:text-white transition-all shadow-md"
                                 title="Eliminar Cliente"
                               >
                                 <Trash2 className="w-5 h-5" />
                               </button>
                             )}
                           </div>
                        </td>
                      </tr>
                      {expandedClient === clientName && group.debts.length > 0 && (
                        <tr className="bg-surface-soft/40 animate-in slide-in-from-top-1 duration-200">
                           <td colSpan={7} className="px-12 py-4">
                              <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                                 <table className="w-full">
                                    <thead className="bg-ink/5">
                                       <tr>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">Emisión</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">Vencimiento</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">ID Factura</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right text-ink">Monto</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right text-ink">Saldo USD</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center text-ink">Estado</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center text-ink">Auditoría</th>
                                       </tr>
                                    </thead>
                                    <tbody>
                                       {group.debts.map((d: Debt) => (
                                          <tr key={d.id} className="border-b border-line/20 hover:bg-brand-gold-soft/10">
                                             <td className="text-[10px] font-black p-2 text-ink">{Utils.fmtFecha(d.fecha)}</td>
                                             <td className={`text-[10px] font-black p-2 ${d.fechaVencimiento < Utils.hoy() && d.estado !== 'pagada' ? 'text-status-danger' : 'text-ink'}`}>
                                                {d.fechaVencimiento === '2099-12-31' ? 'ABIERTA' : Utils.fmtFecha(d.fechaVencimiento)}
                                             </td>
                                             <td className="text-[10px] font-black p-2 mono text-ink">{d.id}</td>
                                             <td className="text-[10px] font-black p-2 text-right text-ink">{Utils.fmtUSD(d.montoUSD)}</td>
                                             <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                                             <td className="p-2 text-center">
                                               <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                                                 {d.estado}
                                               </span>
                                             </td>
                                             <td className="p-2 text-center">
                                                <div className="flex justify-center gap-1">
                                                  <button onClick={() => setShowDetails(d)} className="text-ink hover:text-brand-gold p-1 transition-colors"><Eye className="w-3.5 h-3.5"/></button>
                                                  {d.estado !== 'pagada' && (
                                                    <button onClick={() => eliminarDeuda(d)} className="text-ink hover:text-status-danger p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                                                  )}
                                                </div>
                                             </td>
                                          </tr>
                                       ))}
                                    </tbody>
                                 </table>
                              </div>
                           </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={creditSafePage} totalPages={creditTotalPages} total={creditEntries.length} pageSize={pageSize} onPageChange={setPage} />
      </div>

      {/* MODAL DETALLES AVANZADOS */}
      {showDetails && (
        <div className="modal show" style={{ zIndex: 100 }}><div className="modal-bg" onClick={() => setShowDetails(null)}></div>
          <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Receipt className="w-5 h-5 text-brand-gold" /> HISTORIAL DETALLADO: {showDetails.id}
              </h3>
              <button onClick={() => setShowDetails(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                    <label className="text-[8px] font-black uppercase text-ink block mb-1">Monto Original</label>
                    <p className="text-lg font-black text-ink">{Utils.fmtUSD(showDetails.montoUSD)}</p>
                 </div>
                 <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
                    <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Saldo Actual</label>
                    <p className="text-lg font-black text-brand-gold-deep">{Utils.fmtUSD(showDetails.saldoUSD)}</p>
                 </div>
              </div>

              {(() => {
                const sale = state.ventas.find((v: any) => v.id === showDetails.ventaId || v.id === showDetails.id);
                if (!sale) return null;
                return (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                       <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE COMPRA ORIGINAL</h4>
                       <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(sale.fecha)} - {sale.fecha.split('T')[1]?.slice(0,5)}</span>
                    </div>
                    <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                       <table className="w-full">
                          <thead>
                            <tr className="bg-ink/5">
                               <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Cant</th>
                               <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Descripción</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right text-ink">P. Unit</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right text-ink">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sale.items.map((it: any, idx: number) => (
                              <tr key={idx} className="border-b border-line/20">
                                 <td className="text-[9px] font-black p-2 text-ink">{it.cantidad}</td>
                                 <td className="text-[9px] font-black uppercase p-2 text-ink truncate max-w-[180px]">{it.nombre}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-ink">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3">
                 <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS</h4>
                 <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {(!showDetails.historialPagos || showDetails.historialPagos.length === 0) ? (
                      <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han registrado abonos aún</div>
                    ) : (
                      showDetails.historialPagos.map((p: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                           <div className="space-y-0.5">
                              <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)} - {p.fecha.split('T')[1]?.slice(0,5)}</p>
                              <p className="text-[8px] font-black text-ink mono">REF RECIBO: {p.reciboId}</p>
                           </div>
                           <div className="text-right">
                              <p className="text-xs font-black text-status-success">+{Utils.fmtUSD(p.montoUSD)}</p>
                              <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
                           </div>
                        </div>
                      ))
                    )}
                 </div>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowDetails(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HISTORIAL COMPLETO DE CLIENTE */}
      {showClientHistory && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowClientHistory(null)}></div>
          <div className={`modal-box max-w-4xl bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl transition-all duration-500 ease-in-out ${showDetails ? 'scale-[0.85] opacity-40 -translate-y-48 blur-[1px] pointer-events-none' : ''}`}>
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black uppercase italic tracking-tighter text-xs flex items-center gap-2">
                <Contact className="w-5 h-5 text-brand-gold" /> ESTADO DE CUENTA MAESTRO: {showClientHistory}
              </h3>
              <button onClick={() => setShowClientHistory(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-0 max-h-[70vh] overflow-y-auto bg-white">
               <div className="table-wrap">
                  <table className="w-full">
                    <thead className="bg-surface-soft sticky top-0 z-10">
                      <tr>
                        <th className="text-[9px] font-black uppercase p-4 text-left text-ink">Fecha</th>
                        <th className="text-[9px] font-black uppercase p-4 text-left text-ink">ID Documento</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Monto Total</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Abonado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Saldo Pend.</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center text-ink">Estado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center text-ink">Auditoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.cxc
                        .filter((d: Debt) => {
                          const nombreCliente = d.cliente ? d.cliente.split(' [')[0] : '';
                          return nombreCliente === showClientHistory;
                        })
                        .sort((a: Debt, b: Debt) => b.fecha.localeCompare(a.fecha))
                        .map((d: Debt) => (
                          <tr key={d.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                            <td className="p-4 text-xs font-black text-ink">{Utils.fmtFecha(d.fecha)}</td>
                            <td className="p-4 text-xs font-black mono text-ink">{d.id}</td>
                            <td className="p-4 text-right text-xs font-black text-ink">{Utils.fmtUSD(d.montoUSD)}</td>
                            <td className="p-4 text-right text-xs font-black text-status-success">{Utils.fmtUSD(d.abonadoUSD)}</td>
                            <td className="p-4 text-right text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                            <td className="p-4 text-center">
                              <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                                {d.estado}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <button onClick={() => setShowDetails(d)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5"/></button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
               </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowClientHistory(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal show">
          <div className="modal-bg" onClick={() => setShowModal(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-ink border-b border-white/10 flex justify-between items-center">
              <h3 className="text-white font-black uppercase text-sm flex items-center gap-2">
                <HandCoins className="w-5 h-5 text-brand-gold" /> Cargar Deuda Directa
              </h3>
              <button onClick={() => setShowModal(false)} className="text-white hover:text-brand-gold transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="modal-body p-6 space-y-5">
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Nombre del Cliente</label>
                <input className="form-input text-ink font-black uppercase" value={nuevaDeuda.cliente} onChange={e => setNuevaDeuda({...nuevaDeuda, cliente: e.target.value})} placeholder="ESCRIBA EL NOMBRE..." />
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Cédula / Identificación</label>
                <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                  <select 
                    className="form-select h-11 text-xs font-black bg-surface-soft border-line w-full px-2"
                    value={nuevaDeuda.tipoDoc}
                    onChange={e => setNuevaDeuda({ ...nuevaDeuda, tipoDoc: e.target.value })}
                  >
                    {['V', 'E', 'J', 'G', 'P'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="relative">
                    <Hash className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                    <input 
                      className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                      placeholder="EJ: 13313521"
                      value={nuevaDeuda.cedula}
                      onChange={e => handleCedulaChange(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Teléfono</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                  <input 
                    className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                    placeholder="EJ: 0412-1234567"
                    value={nuevaDeuda.telefono}
                    onChange={e => handleTelefonoChange(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Dirección</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                  <input 
                    className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                    placeholder="ESCRIBA LA DIRECCIÓN..."
                    value={nuevaDeuda.direccion}
                    onChange={e => setNuevaDeuda({...nuevaDeuda, direccion: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Monto (USD)</label>
                <input type="number" className="form-input text-xl text-brand-gold-deep font-black" value={nuevaDeuda.montoUSD} onChange={e => setNuevaDeuda({...nuevaDeuda, montoUSD: parseFloat(e.target.value) || 0})} />
              </div>
              
              <div className="flex items-center gap-2 mb-2 p-3 bg-surface-soft rounded-xl border border-line">
                <button type="button" onClick={() => setNuevaDeuda({...nuevaDeuda, sinVencimiento: !nuevaDeuda.sinVencimiento})} className="text-brand-gold">
                  {nuevaDeuda.sinVencimiento ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                </button>
                <label className="text-ink text-[11px] font-black uppercase cursor-pointer" onClick={() => setNuevaDeuda({...nuevaDeuda, sinVencimiento: !nuevaDeuda.sinVencimiento})}>
                  Sin fecha de vencimiento (Deuda abierta)
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Origen</label>
                  <input type="date" className="form-input text-xs font-black" value={nuevaDeuda.fecha} onChange={e => setNuevaDeuda({...nuevaDeuda, fecha: e.target.value})} />
                </div>
                <div className={`form-group ${nuevaDeuda.sinVencimiento ? 'opacity-20 pointer-events-none' : ''}`}>
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Vencimiento</label>
                  <input type="date" className="form-input text-xs font-black" value={nuevaDeuda.vencimiento} onChange={e => setNuevaDeuda({...nuevaDeuda, vencimiento: e.target.value})} />
                </div>
              </div>
              <button onClick={guardarDeudaDirecta} className="btn btn-primary w-full h-14 font-black uppercase text-xs mt-4 shadow-xl tracking-widest">
                <Save className="w-4 h-4 mr-2" /> Confirmar e Ingresar a Cartera
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}