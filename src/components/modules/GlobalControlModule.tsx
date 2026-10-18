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
import { db } from '@/lib/firebase';
import { collection, doc, updateDoc, onSnapshot, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';

export default function GlobalControlModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [newTerminalName, setNewTerminalName] = useState('');
  const [showAddTerminal, setShowAddTerminal] = useState(false);

  useEffect(() => {
    if (!db) return;
    
    setLoadingUsers(true);
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setUsers(list);
      setLoadingUsers(false);
    }, (error) => {
      console.error("Error monitoreando usuarios:", error);
      setLoadingUsers(false);
    });

    return () => unsubscribe();
  }, []);

  const toggleAccess = async (userId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus;
      const userRef = doc(db, 'users', userId);
      
      // Actualización directa y forzada en Firestore
      await updateDoc(userRef, { 
        accesoBloqueado: newStatus 
      });
      
      toast({ 
        title: newStatus ? "Acceso Bloqueado" : "Acceso Concedido",
        description: `El estado del operador ha sido sincronizado en la nube.`
      });
    } catch (e: any) {
      console.error("Error al actualizar acceso:", e);
      toast({ 
        variant: "destructive", 
        title: "Error de Seguridad", 
        description: "No tiene permisos suficientes para realizar esta acción." 
      });
    }
  };

  const migrateUserIds = async () => {
    if (!confirm('Esta acción migrará los usuarios que usan el correo como ID hacia el UID de Auth. ¿Desea continuar?')) return;
    
    setIsMigrating(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      let migratedCount = 0;
      
      for (const userDoc of querySnapshot.docs) {
        const data = userDoc.data();
        const docId = userDoc.id;
        
        if (docId.includes('@') && data.uid) {
           await setDoc(doc(db, 'users', data.uid), {
             ...data,
             email: data.email?.toLowerCase()
           });
           await deleteDoc(doc(db, 'users', docId));
           migratedCount++;
        }
      }
      
      toast({ 
        title: "Migración Exitosa", 
        description: `Se han actualizado ${migratedCount} registros de usuario.` 
      });
    } catch (e) {
      console.error("Error en migración:", e);
      toast({ variant: "destructive", title: "Fallo en Migración", description: "Fallo al procesar los IDs de usuario." });
    } finally {
      setIsMigrating(false);
    }
  };

  const createTerminal = () => {
    if (!newTerminalName.trim()) return;
    const newTerm: Terminal = {
      id: 'TRM-' + Store.uid().toUpperCase().slice(0, 4),
      nombre: newTerminalName.toUpperCase(),
      usuarioId: null,
      activo: true,
      proximoRecibo: 1
    };
    updateState({ terminales: [...(state.terminales || []), newTerm] });
    setNewTerminalName('');
    setShowAddTerminal(false);
    toast({ title: "Terminal Creado" });
  };

  const deleteTerminal = (id: string) => {
    if (!confirm('¿Eliminar este terminal?')) return;
    updateState({ terminales: state.terminales.filter(t => t.id !== id) });
  };

  const assignUserToTerminal = (terminalId: string, userId: string | null) => {
    const updated = state.terminales.map(t => 
      t.id === terminalId ? { ...t, usuarioId: userId === 'none' ? null : userId } : t
    );
    updateState({ terminales: updated });
    toast({ title: "Asignación Actualizada" });
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