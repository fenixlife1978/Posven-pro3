"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, UserPlus, LogIn } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged, 
  setPersistence, 
  browserSessionPersistence, 
  signOut 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [systemEmpty, setSystemEmpty] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Safety timeout para evitar pantalla blanca infinita si Firebase no responde
    const timer = setTimeout(() => {
      if (!authChecked) setAuthChecked(true);
    }, 8000);

    const checkSystemStatus = async () => {
      if (!db) return;
      try {
        const configDoc = await getDoc(doc(db, 'config', 'general'));
        if (configDoc.exists()) {
          const data = configDoc.data();
          setSystemEmpty(data.isInitialized === false);
        } else {
          setSystemEmpty(true);
        }
      } catch (e) {
        console.warn("Silent status check:", e);
        setSystemEmpty(false);
      }
    };
    checkSystemStatus();

    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.accesoBloqueado) {
              await signOut(auth);
              toast({ variant: "destructive", title: "Acceso Bloqueado", description: "Su cuenta está suspendida." });
              setAuthChecked(true);
              return;
            }
            router.push('/');
          } else {
            setAuthChecked(true);
          }
        } catch (e) {
          setAuthChecked(true);
        }
      } else {
        setAuthChecked(true);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) {
      toast({ variant: "destructive", title: "Atención", description: "Por favor seleccione su rol." });
      return;
    }
    setLoading(true);

    try {
      if (!auth || !db) throw new Error("Servicios no disponibles");
      await setPersistence(auth, browserSessionPersistence);
      
      let user;
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
      }

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists() || isRegistering) {
        const newUserData = {
          email: user.email!.toLowerCase(),
          nombre: email.split('@')[0].toUpperCase(),
          rol: role,
          uid: user.uid,
          fechaCreacion: new Date().toISOString(),
          accesoBloqueado: false
        };
        await setDoc(userDocRef, newUserData);

        if (isRegistering) {
          const configRef = doc(db, 'config', 'general');
          await setDoc(configRef, { isInitialized: true }, { merge: true });
          
          toast({ 
            title: "¡Configuración Exitosa!", 
            description: "Administrador raíz creado. El sistema se ha inicializado.",
            variant: "default"
          });
        }
      } else {
        const userData = userDoc.data();
        if (userData.rol !== role) {
          await signOut(auth);
          toast({ variant: "destructive", title: "Rol Incorrecto", description: `Usted está registrado como ${userData.rol.toUpperCase()}.` });
          setLoading(false);
          return;
        }
      }

      router.push('/');
    } catch (err: any) {
      console.error('Error de Auth:', err);
      let mensaje = "Credenciales inválidas o fallo de conexión.";
      if (err.code === 'auth/email-already-in-use') mensaje = "El correo ya está registrado.";
      if (err.code === 'auth/weak-password') mensaje = "La contraseña es muy débil.";
      
      toast({ variant: "destructive", title: "Error de Acceso", description: mensaje });
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-gold border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">Iniciando Seguridad...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D4C5A6] via-[#C8B99A] to-[#B8A98A] flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-10 animate-in fade-in zoom-in duration-500">
        
        {/* ENCABEZADO CENTRADO SOLICITADO */}
        <div className="mb-10 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 bg-[#C8952E] rounded-xl flex items-center justify-center text-black font-black text-2xl shadow-lg">P</div>
            <div className="font-display font-black text-2xl text-black tracking-tighter">Pos<span className="text-[#C8952E]">VEN</span> Pro</div>
          </div>
          <div className="h-1 w-12 bg-[#C8952E] rounded-full"></div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-extrabold text-black leading-tight mb-2 tracking-tight">
            {isRegistering ? 'Configurar Administrador' : '¡Bienvenido!'}
          </h1>
          <p className="text-[#9CA3AF] text-[14px] font-medium">
            {isRegistering ? 'Cree la cuenta raíz para la gestión del negocio.' : 'Ingrese sus credenciales de acceso.'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Perfil de Usuario</label>
            <select 
              className="form-select h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-4 pr-10 text-black font-semibold focus:border-[#C8952E] outline-none transition-all cursor-pointer w-full" 
              value={role} 
              onChange={e => setRole(e.target.value)} 
              required
            >
              <option value="" disabled>Seleccione Rol</option>
              <option value="administrador">Administrador</option>
              <option value="cajero">Cajero / Operador</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Correo Electrónico</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors">
                <Mail className="w-5 h-5" />
              </div>
              <input 
                type="email" 
                required 
                className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-4 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" 
                placeholder="ejemplo@correo.com" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Contraseña</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors">
                <Lock className="w-5 h-5" />
              </div>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-12 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" 
                placeholder="••••••••" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#C8952E]"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full h-[56px] bg-[#C8952E] text-black font-black text-sm rounded-2xl flex items-center justify-center hover:bg-[#D9A540] transition-all disabled:opacity-50 shadow-lg uppercase tracking-widest"
          >
            {loading ? <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : (isRegistering ? "Configurar Acceso Inicial" : "Iniciar Sesión")}
          </button>
        </form>

        {systemEmpty && (
          <div className="mt-6 text-center border-t border-line pt-6">
            <button 
              onClick={() => setIsRegistering(!isRegistering)} 
              className="text-[11px] font-black text-[#C8952E] hover:underline flex items-center justify-center gap-2 mx-auto uppercase tracking-tighter"
            >
              {isRegistering ? <><LogIn className="w-4 h-4" /> Volver al Ingreso</> : <><UserPlus className="w-4 h-4" /> Registrar Administrador Raíz</>}
            </button>
            <p className="text-[9px] font-bold text-ink/30 uppercase mt-2">Detección de sistema nuevo activada</p>
          </div>
        )}
      </div>
    </div>
  );
}