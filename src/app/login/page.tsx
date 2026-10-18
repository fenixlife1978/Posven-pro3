"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const POSVEN_TAB_SESSION_KEY = 'posven_session_id';

function getTabSessionId() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(POSVEN_TAB_SESSION_KEY);
}

function installLoginTabSessionFetch() {
  if (typeof window === 'undefined' || (window as any).__posvenTabFetchInstalled) return;
  (window as any).__posvenTabFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let sameOrigin = false;
    try { sameOrigin = rawUrl.startsWith('/') || new URL(rawUrl, window.location.href).origin === window.location.origin; } catch {}
    if (!sameOrigin) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set('x-posven-session-mode', 'tab');
    const sessionId = getTabSessionId();
    if (sessionId) headers.set('x-posven-session', sessionId);
    else headers.delete('x-posven-session');
    return nativeFetch(input, { ...init, headers });
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Inicializando Base de Datos Turso...");

  useEffect(() => {
    installLoginTabSessionFetch();
    let cancelled = false;
    const checkTursoSession = async () => {
      setStatusMessage("Inicializando Base de Datos Turso...");
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        if (response.ok) {
          setStatusMessage("Sesión Turso encontrada. Ingresando...");
          router.push("/");
          return;
        }
        if (!cancelled) setStatusMessage(response.status === 503 ? "Turso no está disponible." : "Turso respondió, pero no hay sesión activa.");
      } catch {
        if (!cancelled) setStatusMessage("No fue posible conectar con Turso.");
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    checkTursoSession();
    return () => { cancelled = true; };
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) {
      toast({ variant: "destructive", title: "Atención", description: "Por favor seleccione su rol." });
      return;
    }
    setLoading(true);
    setStatusMessage("Conectando con Base de Datos Turso...");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ identifier: email, password, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || ("Error de autenticación (" + response.status + ")."));
      setStatusMessage("Turso autenticó correctamente. Ingresando...");
      if (data?.sessionId) sessionStorage.setItem(POSVEN_TAB_SESSION_KEY, String(data.sessionId));
      toast({ title: "Acceso autorizado", description: "Bienvenido, " + (data.user?.nombre || email) + "." });
      router.push("/");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error de Acceso", description: String(err?.message || "No fue posible conectar con el servidor.") });
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-gold border-t-transparent rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 text-center px-6">{statusMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D4C5A6] via-[#C8B99A] to-[#B8A98A] flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-10 animate-in fade-in zoom-in duration-500">
        <div className="mb-10 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 bg-[#C8952E] rounded-xl flex items-center justify-center text-black font-black text-2xl shadow-lg">P</div>
            <div className="font-display font-black text-2xl text-black tracking-tighter">Pos<span className="text-[#C8952E]">VEN</span> Pro</div>
          </div>
          <div className="h-1 w-12 bg-[#C8952E] rounded-full" />
        </div>
        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-extrabold text-black leading-tight mb-2 tracking-tight">¡Bienvenido!</h1>
          <p className="text-[#9CA3AF] text-[14px] font-medium">Ingrese sus credenciales de acceso.</p>
        </div>
        <form onSubmit={handleAuth} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Perfil de Usuario</label>
            <select className="form-select h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-4 pr-10 text-black font-semibold focus:border-[#C8952E] outline-none transition-all cursor-pointer w-full" value={role} onChange={e => setRole(e.target.value)} required>
              <option value="" disabled>Seleccione Rol</option>
              <option value="administrador">Administrador</option>
              <option value="cajero">Cajero / Operador</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Correo Electrónico</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors"><Mail className="w-5 h-5" /></div>
              <input type="email" required className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-4 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" placeholder="ejemplo@correo.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Contraseña</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors"><Lock className="w-5 h-5" /></div>
              <input type={showPassword ? "text" : "password"} required className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-12 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#C8952E]">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full h-[56px] bg-[#C8952E] text-black font-black text-sm rounded-2xl flex items-center justify-center hover:bg-[#D9A540] transition-all disabled:opacity-50 shadow-lg uppercase tracking-widest">
            {loading ? <span className="flex items-center gap-3"><div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />{statusMessage}</span> : "Iniciar Sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
