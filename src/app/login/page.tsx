"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, UserRound, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const POSVEN_TAB_SESSION_KEY = "posven_session_id";

function getTabSessionId() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(POSVEN_TAB_SESSION_KEY);
}

function installLoginTabSessionFetch() {
  if (typeof window === "undefined" || (window as any).__posvenTabFetchInstalled) return;
  (window as any).__posvenTabFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let sameOrigin = false;
    try { sameOrigin = rawUrl.startsWith("/") || new URL(rawUrl, window.location.href).origin === window.location.origin; } catch {}
    if (!sameOrigin) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set("x-posven-session-mode", "tab");
    const sessionId = getTabSessionId();
    if (sessionId) headers.set("x-posven-session", sessionId);
    else headers.delete("x-posven-session");
    return nativeFetch(input, { ...init, headers });
  };
}

type SetupStatus = "checking" | "login" | "setup" | "unavailable";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<SetupStatus>("checking");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Comprobando la instalación local...");

  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("administrador");
  const [loginPassword, setLoginPassword] = useState("");

  const [nombre, setNombre] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    // Al llegar a /login después de cerrar sesión, descartar siempre el token
    // de pestaña anterior. Un token revocado o heredado no debe contaminar las
    // peticiones de comprobación ni dejar el formulario en estado de espera.
    try { sessionStorage.removeItem(POSVEN_TAB_SESSION_KEY); } catch {}
    installLoginTabSessionFetch();
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const initialize = async () => {
      try {
        const session = await fetch("/api/auth/session", {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (session.ok) { router.replace("/"); return; }
        const response = await fetch("/api/auth/setup", {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ready) throw new Error(data.error || "Servidor local no disponible.");
        if (!cancelled) setMode(data.needsSetup ? "setup" : "login");
      } catch (error: any) {
        if (!cancelled) {
          setStatusMessage(error?.name === "AbortError"
            ? "El servidor local tarda demasiado en responder. Compruebe la conexión y reintente."
            : error?.message || "No fue posible conectar con el servidor local.");
          setMode("unavailable");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };
    initialize();
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [router]);

  useEffect(() => {
    if (mode !== "login" && mode !== "setup") return;
    // Al mostrar el formulario, devolver foco real al primer campo editable.
    const selector = mode === "setup" ? 'input[autocomplete="name"]' : 'input[autocomplete="username"]';
    const frame = window.requestAnimationFrame(() => {
      const field = document.querySelector<HTMLInputElement>(selector);
      field?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  const acceptSession = (data: any) => {
    if (data?.sessionId) sessionStorage.setItem(POSVEN_TAB_SESSION_KEY, String(data.sessionId));
    toast({ title: "Acceso autorizado", description: "Bienvenido, " + (data.user?.nombre || data.user?.username || "administrador") + "." });
    router.replace("/");
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ identifier, password: loginPassword, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible iniciar sesión.");
      acceptSession(data);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error de acceso", description: error?.message || "No fue posible conectar con el servidor." });
    } finally { setLoading(false); }
  };

  const handleFirstAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast({ variant: "destructive", title: "Contraseñas diferentes", description: "Confirme exactamente la misma contraseña." });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ nombre, username, email, password, confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible crear el administrador.");
      acceptSession(data);
    } catch (error: any) {
      toast({ variant: "destructive", title: "No se pudo completar la configuración", description: error?.message || "Intente nuevamente." });
    } finally { setLoading(false); }
  };

  const inputClass = "w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl px-4 text-black font-semibold placeholder:text-[#A1A1AA] focus:border-[#C8952E] focus:bg-white outline-none transition-all";
  const labelClass = "text-[10px] font-black uppercase text-black/50 tracking-widest block ml-1 mb-2";

  if (mode === "checking") return (
    <div className="min-h-screen bg-[#E8DEC9] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4"><div className="w-10 h-10 border-4 border-[#C8952E] border-t-transparent rounded-full animate-spin" /><p className="text-xs font-bold uppercase tracking-widest text-black/50">{statusMessage}</p></div>
    </div>
  );

  if (mode === "unavailable") return (
    <div className="min-h-screen bg-[#E8DEC9] flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4"><Lock /></div>
        <h1 className="text-xl font-black text-black mb-2">Servidor local no disponible</h1>
        <p className="text-sm text-gray-500 mb-6">{statusMessage}</p>
        <button onClick={() => window.location.reload()} className="w-full h-12 rounded-xl bg-[#C8952E] font-black uppercase text-sm">Reintentar conexión</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D4C5A6] via-[#C8B99A] to-[#B8A98A] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[470px] bg-white rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.22)] p-6 sm:p-9">
        <div className="flex flex-col items-center mb-7">
          <div className="flex items-center gap-3 mb-3"><div className="w-11 h-11 bg-[#C8952E] rounded-xl flex items-center justify-center text-black font-black text-2xl">P</div><div className="font-black text-2xl text-black tracking-tight">Pos<span className="text-[#C8952E]">VEN</span> Pro</div></div>
          <div className="h-1 w-12 bg-[#C8952E] rounded-full" />
        </div>

        {mode === "setup" ? (
          <>
            <div className="text-center mb-7">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-[#FBF4E5] text-[#A87518] flex items-center justify-center mb-3"><ShieldCheck className="w-6 h-6" /></div>
              <h1 className="text-2xl font-black text-black mb-2">Configurar primer administrador</h1>
              <p className="text-sm text-gray-500 leading-relaxed">Esta instalación todavía no tiene administrador. Cree la cuenta principal para proteger y administrar POSVEN3.</p>
            </div>
            <form onSubmit={handleFirstAdmin} className="space-y-4">
              <div><label className={labelClass}>Nombre y apellido</label><input className={inputClass} value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} placeholder="Nombre del responsable" /></div>
              <div><label className={labelClass}>Usuario de acceso</label><div className="relative"><UserRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input className={inputClass + " pl-12"} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" placeholder="admin" /></div><p className="text-[11px] text-gray-400 mt-1 ml-1">3–32 caracteres: letras, números, punto, guion o guion bajo.</p></div>
              <div><label className={labelClass}>Correo electrónico</label><div className="relative"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input type="email" className={inputClass + " pl-12"} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required placeholder="correo@empresa.com" /></div></div>
              <div><label className={labelClass}>Contraseña (mínimo 10 caracteres)</label><div className="relative"><Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input type={showPassword ? "text" : "password"} className={inputClass + " pl-12 pr-12"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={10} placeholder="Cree una contraseña segura" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div></div>
              <div><label className={labelClass}>Repita la contraseña</label><input type="password" className={inputClass} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" required minLength={10} placeholder="Confirme la contraseña" /></div>
              <button type="submit" disabled={loading} className="w-full h-14 bg-[#C8952E] text-black font-black text-sm rounded-2xl hover:bg-[#D9A540] disabled:opacity-50 shadow-lg uppercase tracking-widest">{loading ? "Configurando administrador..." : "Crear administrador y entrar"}</button>
              <p className="text-[11px] text-center text-gray-400">La cuenta se crea una sola vez en la base SQLite del servidor.</p>
            </form>
          </>
        ) : (
          <>
            <div className="text-center mb-8"><h1 className="text-[28px] font-extrabold text-black mb-2">¡Bienvenido!</h1><p className="text-gray-400 text-sm">Ingrese sus credenciales de acceso.</p></div>
            <form onSubmit={handleLogin} className="space-y-5">
              <div><label className={labelClass}>Perfil de usuario</label><select className={inputClass} value={role} onChange={e => setRole(e.target.value)} required><option value="administrador">Administrador</option><option value="cajero">Cajero / Operador</option></select></div>
              <div><label className={labelClass}>Correo o usuario</label><div className="relative"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input className={inputClass + " pl-12"} value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" required placeholder="Usuario o correo" /></div></div>
              <div><label className={labelClass}>Contraseña</label><div className="relative"><Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input type={showPassword ? "text" : "password"} className={inputClass + " pl-12 pr-12"} value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div></div>
              <button type="submit" disabled={loading} className="w-full h-14 bg-[#C8952E] text-black font-black text-sm rounded-2xl hover:bg-[#D9A540] disabled:opacity-50 shadow-lg uppercase tracking-widest">{loading ? "Verificando..." : "Iniciar sesión"}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
