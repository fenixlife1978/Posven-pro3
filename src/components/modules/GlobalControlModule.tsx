"use client";

import React, { useState, useEffect } from 'react';
import { AppState, Terminal } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { 
  ShieldCheck, 
  Monitor, 
  Users, 
  Plus, 
  Lock, 
  Unlock, 
  Trash2, 
  AlertTriangle,
  X,
  Mail,
  RefreshCw,
  Database
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function GlobalControlModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [newTerminalName, setNewTerminalName] = useState('');
  const [showAddTerminal, setShowAddTerminal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setLoadingUsers(true);

    (async () => {
      try {
        const response = await fetch('/api/users', { credentials: 'include', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'No se pudieron cargar los usuarios desde Turso.');
        if (!cancelled) {
          setUsers(Array.isArray(data.usuarios) ? data.usuarios : (Array.isArray(data.users) ? data.users : []));
          setLoadingUsers(false);
        }
      } catch (error) {
        console.error("Error cargando usuarios desde Turso:", error);
        if (!cancelled) setLoadingUsers(false);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const toggleAccess = async (userId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus;
      const response = await fetch('/api/users/' + encodeURIComponent(userId), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accesoBloqueado: newStatus }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        if (response.status === 503) throw new Error('Turso no está configurado.');
        throw new Error(String(body?.error || 'No se pudo actualizar el acceso.'));
      }
      toast({
        title: newStatus ? "Acceso Bloqueado" : "Acceso Concedido",
        description: 'El estado del operador fue actualizado en Turso.'
      });
    } catch (e: any) {
      console.error("Error al actualizar acceso:", e);
      toast({
        variant: "destructive",
        title: "Error de Seguridad",
        description: e?.message || "No tiene permisos suficientes para realizar esta acción."
      });
    }
  };

  const migrateUserIds = async () => {
    toast({
      title: "Migración no requerida",
      description: "La gestión de usuarios y sus identificadores ya se realiza mediante Turso."
    });
  };


  const createTerminal = async () => {
    if (!newTerminalName.trim()) return;
    // Prefijo de caja correlativo (C1, C2, ...) para numeración de facturas independiente por caja.
    const usedPrefixes = (state.terminales || [])
      .map(t => (t.prefijoCaja || '').replace(/^C/, ''))
      .map(Number)
      .filter(n => !isNaN(n) && n > 0);
    const nextNum = (usedPrefixes.length ? Math.max(...usedPrefixes) : 0) + 1;
    const newTerm: Terminal = {
      id: 'TRM-' + Store.uid().toUpperCase(),
      nombre: newTerminalName.toUpperCase(),
      usuarioId: null,
      activo: true,
      proximoRecibo: 1,
      proximoCobroDeuda: 1,
      proximoPagoProveedor: 1,
      proximaDevolucion: 1,
      proximaAnulacion: 1,
      prefijoCaja: 'C' + nextNum,
      isCashOpen: false,
      cashData: null,
      cashHistory: [],
      fondoCajaHoyUSD: 0,
      fondoCajaHoyBS: 0,
      ultimoZ: 0,
      fechaUltimoZ: '',
      acumuladoHistorico: 0
    };
    try {
      const response = await fetch('/api/turso/store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'terminalUpsert', terminal: newTerm }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(String(body?.error || 'No se pudo crear el terminal.'));
      }
      const persisted = body?.terminal || newTerm;
      updateState({ terminales: [...(state.terminales || []).filter(t => t.id !== persisted.id), persisted] });
      setNewTerminalName('');
      setShowAddTerminal(false);
      toast({ title: "Terminal Creado", description: "Terminal guardado en Turso." });
    } catch (e: any) {
      console.error("Error creando terminal:", e);
      toast({ variant: "destructive", title: "Error al crear terminal", description: e?.message || "No se pudo guardar el terminal." });
    }
  };

  const deleteTerminal = async (id: string) => {
    if (!confirm('¿Eliminar este terminal?')) return;
    try {
      const response = await fetch('/api/turso/store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'terminalDelete', terminalId: id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(String(body?.error || 'No se pudo eliminar el terminal.'));
      }
      updateState({ terminales: state.terminales.filter(t => t.id !== id) });
      toast({ title: "Terminal Eliminado", description: "Terminal eliminado de Turso." });
    } catch (e: any) {
      console.error("Error eliminando terminal:", e);
      toast({ variant: "destructive", title: "Error al eliminar terminal", description: e?.message || "No se pudo eliminar el terminal." });
    }
  };

  const assignUserToTerminal = async (terminalId: string, userId: string | null) => {
    const assignedUserId = userId === 'none' ? null : userId;
    try {
      const response = await fetch('/api/turso/store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'terminalPatch', terminalId, patch: { usuarioId: assignedUserId } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(String(body?.error || 'No se pudo actualizar la asignación.'));
      }
      const persisted = body?.terminal;
      const updated = state.terminales.map(t =>
        t.id === terminalId ? (persisted || { ...t, usuarioId: assignedUserId }) : t
      );
      updateState({ terminales: updated });
      toast({ title: "Asignación Actualizada", description: "Responsable guardado en Turso." });
    } catch (e: any) {
      console.error("Error actualizando asignación:", e);
      toast({ variant: "destructive", title: "Error de asignación", description: e?.message || "No se pudo guardar la asignación." });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <ShieldCheck className="text-brand-gold w-7 h-7" /> GLOBAL CONTROL SYSTEM
          </h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Seguridad Centralizada y Gestión de Terminales</p>
        </div>
        
        <button 
          onClick={migrateUserIds}
          disabled={isMigrating}
          className="btn btn-secondary h-10 px-6 border-line text-ink font-black uppercase text-[10px] tracking-widest flex items-center gap-2 hover:bg-surface-soft shadow-sm"
        >
          {isMigrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4 text-brand-gold" />}
          Migrar IDs de Usuario
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-8">
        <div className="space-y-6">
          <div className="card shadow-xl border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Users className="w-5 h-5 text-brand-gold" /> ESTADO DE ACCESO DE OPERADORES
              </h3>
              <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-status-success animate-pulse"></div>
                 <span className="text-[8px] text-white/40 font-black uppercase tracking-widest">Live Sync</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-ink font-black text-[10px] uppercase">Operador / Identificador</th>
                    <th className="text-ink font-black text-[10px] uppercase">UID</th>
                    <th className="text-ink font-black text-[10px] uppercase text-center">Estado de Seguridad</th>
                    <th className="text-ink font-black text-[10px] uppercase text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {loadingUsers ? (
                    <tr><td colSpan={4} className="text-center py-10 animate-pulse text-ink/20 font-black uppercase">Sincronizando perfiles...</td></tr>
                  ) : users.filter(u => u.rol === 'cajero').map(u => {
                    const isBlocked = u.accesoBloqueado === true;
                    return (
                      <tr key={u.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                        <td className="py-4 px-6">
                          <div className="text-ink font-black text-xs uppercase">{u.nombre}</div>
                          <div className="flex items-center gap-1.5 text-[9px] font-bold text-ink/40 lowercase">
                            <Mail className="w-3 h-3" /> {u.email}
                          </div>
                        </td>
                        <td>
                          <span className="mono text-[9px] font-black text-ink/40 uppercase">ID: {u.id.slice(0, 10)}...</span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isBlocked ? 'bg-status-danger animate-pulse' : 'bg-status-success'}`} />
                            <span className={`font-black text-[10px] uppercase ${isBlocked ? 'text-status-danger' : 'text-status-success'}`}>
                              {isBlocked ? 'Bloqueado' : 'Autorizado'}
                            </span>
                          </div>
                        </td>
                        <td className="text-right px-6">
                          <button 
                            onClick={() => toggleAccess(u.id, isBlocked)}
                            className={`btn h-10 px-6 font-black text-[10px] uppercase shadow-md flex items-center gap-2 ml-auto ${isBlocked ? 'btn-primary' : 'bg-status-danger text-white hover:bg-status-danger/90'}`}
                          >
                            {isBlocked ? <><Unlock className="w-4 h-4" /> Conceder</> : <><Lock className="w-4 h-4" /> Bloquear</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!loadingUsers && users.filter(u => u.rol === 'cajero').length === 0 && (
                    <tr><td colSpan={4} className="text-center py-20 text-ink/20 font-black italic">No hay cajeros registrados en el sistema</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-5 bg-brand-gold-soft/20 border border-brand-gold/20 rounded-2xl flex items-start gap-4">
             <AlertTriangle className="text-brand-gold-deep w-6 h-6 shrink-0 mt-1" />
             <div>
                <h4 className="text-brand-gold-deep font-black uppercase text-xs mb-1">Mantenimiento de Identidades</h4>
                <p className="text-[10px] text-brand-gold-deep/70 font-bold leading-relaxed uppercase">
                  Si un cajero no puede entrar aunque su estado sea "Autorizado", verifique que su ID coincida con su UID de Auth. Use el botón superior para corregir registros antiguos.
                </p>
             </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card shadow-xl border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Monitor className="w-5 h-5 text-brand-gold" /> TERMINALES DE VENTA
              </h3>
              <button onClick={() => setShowAddTerminal(true)} className="btn-icon bg-brand-gold text-white rounded-lg h-7 w-7"><Plus className="w-4 h-4"/></button>
            </div>
            
            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
              {state.terminales.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                   <div className="p-4 bg-surface-soft rounded-full w-14 h-14 mx-auto flex items-center justify-center text-ink/10"><Monitor /></div>
                   <p className="text-[10px] font-black uppercase text-ink/20">Cree su primer terminal operativo</p>
                </div>
              ) : state.terminales.map(t => (
                <div key={t.id} className="p-4 bg-surface-soft border border-line rounded-xl space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-black text-ink uppercase">{t.nombre}</div>
                      <div className="text-[9px] font-black text-ink/40 mono">{t.id}</div>
                    </div>
                    <button onClick={() => deleteTerminal(t.id)} className="text-ink/20 hover:text-status-danger transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase text-ink/50 block">Responsable Asignado</label>
                    <select 
                      className="form-select h-9 text-[10px] font-black uppercase bg-white border-line"
                      value={t.usuarioId || 'none'}
                      onChange={e => assignUserToTerminal(t.id, e.target.value)}
                    >
                      <option value="none">LIBRE / SIN ASIGNAR</option>
                      {users.filter(u => u.rol === 'cajero').map(u => (
                        <option key={u.id} value={u.id}>{u.nombre.toUpperCase()} [{u.id.slice(0,4)}]</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showAddTerminal && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowAddTerminal(false)}></div>
          <div className="modal-box bg-white max-w-sm border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-3 px-5 border-b border-line bg-surface-soft flex justify-between items-center">
              <h3 className="text-ink font-black uppercase text-xs">Añadir Nuevo Terminal</h3>
              <button onClick={() => setShowAddTerminal(false)}><X className="w-4 h-4 text-ink/40" /></button>
            </div>
            <div className="modal-body p-6 space-y-4">
               <div className="form-group">
                 <label className="text-ink text-[10px] font-black uppercase block mb-1">Nombre Identificador</label>
                 <input 
                  className="form-input text-sm font-black uppercase" 
                  placeholder="Ej: CAJA PRINCIPAL" 
                  value={newTerminalName}
                  onChange={e => setNewTerminalName(e.target.value)}
                  autoFocus
                 />
               </div>
               <button onClick={createTerminal} className="btn btn-primary w-full h-12 font-black uppercase text-xs shadow-md">Crear Terminal Lógico</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}