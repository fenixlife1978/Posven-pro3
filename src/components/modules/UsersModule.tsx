
"use client";

import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, Edit2, Shield, X, Save, Users as UsersIcon, Mail, Lock, User as UserIcon } from 'lucide-react';
import { db, firebaseConfig } from '@/lib/firebase';
import { collection, doc, setDoc, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { toast } from '@/hooks/use-toast';

interface UserProfile {
  id: string;
  nombre: string;
  email: string;
  rol: 'administrador' | 'cajero';
  fechaCreacion: string;
  uid: string;
}

export default function UsersModule() {
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: 'cajero' as 'administrador' | 'cajero'
  });

  const cargarUsuarios = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      const list: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as UserProfile);
      });
      setUsuarios(list);
    } catch (error) {
      console.error("Error cargando usuarios:", error);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleSave = async () => {
    if (!formData.nombre || !formData.email || (!editingId && !formData.password)) {
      alert("Por favor complete todos los campos requeridos.");
      return;
    }

    setLoading(true);
    let secondaryApp;

    try {
      if (editingId) {
        // En edición el ID ya es el UID
        const userRef = doc(db, 'users', editingId);
        await updateDoc(userRef, {
          nombre: formData.nombre,
          rol: formData.rol
        });
        toast({ title: "Perfil Actualizado", description: "Los cambios se guardaron correctamente." });
      } else {
        // 1. Crear usuario en Firebase Auth usando una APP SECUNDARIA
        // Esto permite crear un usuario sin cerrar la sesión administrativa actual
        secondaryApp = initializeApp(firebaseConfig, "SecondaryAuthApp_" + Date.now());
        const secondaryAuth = getAuth(secondaryApp);
        
        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth, 
          formData.email, 
          formData.password
        );

        // 2. Crear perfil en Firestore usando el UID como ID DEL DOCUMENTO
        const newUid = userCredential.user.uid;
        await setDoc(doc(db, 'users', newUid), {
          uid: newUid,
          nombre: formData.nombre.toUpperCase(),
          email: formData.email.toLowerCase(),
          rol: formData.rol,
          fechaCreacion: new Date().toISOString(),
          accesoBloqueado: false
        });

        toast({ 
          title: "Usuario Creado", 
          description: "Acceso configurado exitosamente con UID: " + newUid.slice(0, 6)
        });
      }
      
      setShowModal(false);
      setEditingId(null);
      setFormData({ nombre: '', email: '', password: '', rol: 'cajero' });
      await cargarUsuarios();

    } catch (error: any) {
      console.error("Error al crear usuario:", error);
      let msg = "Error técnico al procesar el registro.";
      if (error.code === 'auth/email-already-in-use') msg = "El correo ya está registrado.";
      alert(msg);
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp).catch(() => {});
      setLoading(false);
    }
  };

  const handleEdit = (u: UserProfile) => {
    setEditingId(u.id);
    setFormData({
      nombre: u.nombre,
      email: u.email,
      password: '',
      rol: u.rol
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Está seguro de eliminar este acceso? El perfil será borrado de Firestore permanentemente.")) return;
    try {
      await deleteDoc(doc(db, 'users', id));
      await cargarUsuarios();
      toast({ title: "Registro eliminado" });
    } catch (error) {
      alert("Error al eliminar el documento.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl">Gestión de Usuarios</h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Control de Accesos y Roles del Sistema</p>
        </div>
        <button onClick={() => { setEditingId(null); setFormData({nombre:'', email:'', password:'', rol:'cajero'}); setShowModal(true); }} className="btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-lg">
          <UserPlus className="w-4 h-4" /> Crear Nuevo Usuario
        </button>
      </div>

      <div className="card shadow-xl border-line rounded-xl overflow-hidden">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-brand-gold" /> PERSONAL AUTORIZADO
          </h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr className="bg-surface-soft">
                <th className="text-ink font-black text-[10px] uppercase">Nombre</th>
                <th className="text-ink font-black text-[10px] uppercase">Identificador (Email / UID)</th>
                <th className="text-ink font-black text-[10px] uppercase">Rol</th>
                <th className="text-ink font-black text-[10px] uppercase">Registro</th>
                <th className="text-ink font-black text-[10px] uppercase text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {usuarios.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-20 text-ink/20 font-black uppercase italic">No hay usuarios configurados</td></tr>
              ) : (
                usuarios.map(u => (
                  <tr key={u.id} className="border-b border-line/40 hover:bg-surface-warm/20 transition-colors">
                    <td className="text-ink font-black text-xs uppercase">{u.nombre}</td>
                    <td>
                      <div className="text-ink font-bold text-xs">{u.email}</div>
                      <div className="text-[8px] font-black text-ink/40 mono">UID: {u.uid}</div>
                    </td>
                    <td><span className={`badge ${u.rol === 'administrador' ? 'badge-info' : 'badge-neutral'} font-black text-[8px] uppercase px-3`}>{u.rol}</span></td>
                    <td className="text-ink font-bold text-xs opacity-60">{u.fechaCreacion ? u.fechaCreacion.slice(0, 10) : '-'}</td>
                    <td className="text-center">
                       <div className="flex justify-center gap-2">
                          <button onClick={() => handleEdit(u)} className="btn-icon h-8 w-8 text-ink hover:text-brand-gold" title="Modificar"><Edit2 className="w-4 h-4"/></button>
                          <button onClick={() => handleDelete(u.id)} className="btn-icon h-8 w-8 text-ink hover:text-status-danger" title="Eliminar"><Trash2 className="w-4 h-4"/></button>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal show">
          <div className="modal-bg" onClick={() => setShowModal(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line">
            <div className="modal-head py-4 px-6 border-b border-line bg-surface-soft">
              <h3 className="text-ink font-black uppercase text-sm flex items-center gap-2"><Shield className="w-5 h-5 text-brand-gold" /> {editingId ? 'Editar Perfil' : 'Nuevo Acceso'}</h3>
              <button onClick={() => setShowModal(false)} className="text-ink hover:text-brand-gold"><X /></button>
            </div>
            <div className="modal-body p-6 space-y-5">
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Nombre Completo</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 w-4 h-4 text-ink opacity-30" />
                  <input className="form-input pl-10" value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} placeholder="Ej: JUAN PEREZ" />
                </div>
              </div>
              
              <div className={`form-group ${editingId ? 'opacity-40 pointer-events-none' : ''}`}>
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Email de Ingreso</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-ink opacity-30" />
                  <input type="email" className="form-input pl-10" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="user@posven.pro" />
                </div>
              </div>

              {!editingId && (
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Contraseña Temporal</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-ink opacity-30" />
                    <input type="password" minLength={6} className="form-input pl-10" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="Mín. 6 caracteres" />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Permisos</label>
                <select className="form-select h-11 font-black uppercase text-xs" value={formData.rol} onChange={e => setFormData({...formData, rol: e.target.value as any})}>
                  <option value="cajero">Cajero / Operador</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>

              <button onClick={handleSave} disabled={loading} className="btn btn-primary w-full h-14 font-black uppercase text-sm mt-4 shadow-xl">
                <Save className="w-4 h-4" /> {loading ? 'PROCESANDO...' : (editingId ? 'ACTUALIZAR DATOS' : 'CREAR USUARIO')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
