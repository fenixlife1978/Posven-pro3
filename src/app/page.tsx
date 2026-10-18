"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  HandCoins, 
  FileText, 
  BarChart3, 
  Settings,
  Users,
  Menu,
  Wifi,
  WifiOff,
  Clock as ClockIcon,
  LogOut,
  Bell,
  ShieldCheck,
  Truck,
  BookOpen,
  ShoppingBag,
  Monitor,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  X,
  CheckCircle2,
  Calendar
} from 'lucide-react';
import { Store, initialState, Utils } from '@/lib/db-store';
import { AppState, Terminal, Debt } from '@/lib/types';
import DashboardModule from '@/components/modules/DashboardModule';
import { InventoryModule } from '@/components/modules/InventoryModule';
import SalesModule from '@/components/modules/SalesModule';
import PurchaseModule from '@/components/modules/PurchaseModule';
import CxCModule from '@/components/modules/CxCModule';
import CxPModule from '@/components/modules/CxPModule';
import ReportsModule from '@/components/modules/ReportsModule';
import ConfigModule from '@/components/modules/ConfigModule';
import UsersModule from '@/components/modules/UsersModule';
import GlobalControlModule from '@/components/modules/GlobalControlModule';
import SuppliersModule from '@/components/modules/SuppliersModule';
import AccountingModule from '@/components/modules/AccountingModule';

const POSVEN_TAB_SESSION_KEY = 'posven_session_id';

function installPosvenTabSessionFetch() {
  if (typeof window === 'undefined' || (window as any).__posvenTabFetchInstalled) return;
  (window as any).__posvenTabFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Solo intervenimos en llamadas a la API de PosVEN. El wrapper de sesión
    // no debe alterar otros fetch del navegador ni asumir que el primer
    // argumento es un Request con headers disponibles.
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input && typeof input === 'object' && 'url' in input ? String((input as Request).url) : '');
    let sameOrigin = false;
    try {
      sameOrigin = rawUrl.startsWith('/') || new URL(rawUrl, window.location.href).origin === window.location.origin;
    } catch {}
    if (!sameOrigin || !rawUrl.startsWith('/api/')) return nativeFetch(input, init);

    const sourceHeaders =
      init?.headers ??
      (input && typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined);
    const headers = new Headers(sourceHeaders);
    headers.set('x-posven-session-mode', 'tab');
    const sessionId = sessionStorage.getItem(POSVEN_TAB_SESSION_KEY);
    if (sessionId) headers.set('x-posven-session', sessionId);
    else headers.delete('x-posven-session');

    return nativeFetch(input, { ...init, headers });
  };
}

export default function LicoreriaPOS() {
  const router = useRouter();
  const [state, setState] = useState<AppState>(initialState);
  const [activeModule, setActiveTab] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [showApertura, setShowApertura] = useState(false);
  const [aperturaData, setAperturaData] = useState({ bs: '', usd: '' });
  
  // Estados para Notificaciones de CxP
  const [dueDebts, setDueDebts] = useState<Debt[]>([]);
  const [showCxPAlert, setShowCxPAlert] = useState(false);
  
  const moduleInitialized = useRef(false);
  const criticalClickRef = useRef<{ target: Element | null; time: number }>({ target: null, time: 0 });

  useEffect(() => {
    setMounted(true);
    installPosvenTabSessionFetch();

    const captureError = (e: ErrorEvent) => {
      try {
        localStorage.setItem('posven_last_error', JSON.stringify({ message: e?.message || 'error', stack: e?.error?.stack || '', time: new Date().toISOString() }));
      } catch {}
    };
    const preventCriticalDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button) return;
      const label = String(button.innerText || button.getAttribute('aria-label') || '').toUpperCase();
      const critical = /REGISTR|GUARDAR|PROCESAR|CONFIRMAR|ASENTAR|PAGAR|PAGO|LIQUIDAR|ANULAR|ELIMINAR|DEVOLVER|DEVOLUCIÓN|CARGAR A CARTERA|GUARDAR Y CARGAR|TERMINAR/.test(label);
      if (!critical) return;
      const now = Date.now();
      if (criticalClickRef.current.target === button && now - criticalClickRef.current.time < 700) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      criticalClickRef.current = { target: button, time: now };
    };
    document.addEventListener('click', preventCriticalDoubleClick, true);
    window.addEventListener('error', captureError);

    const timerSafety = setTimeout(() => setLoading(false), 8000);

    const initializeFromTurso = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          const currentUser = data.user;
          const legacyUid = currentUser?.id;
          const profile = {
            ...currentUser,
            uid: legacyUid,
            accesoBloqueado: false,
          };
          setUserRole(currentUser.rol);
          setUserProfile(profile);
          setUser({ uid: legacyUid, email: currentUser.email, ...currentUser });
          setState(prev => ({ ...prev, user: profile, isAuthenticated: true } as AppState));

          if (currentUser.rol === 'cajero') {
            // Turso es la única fuente de verdad de autenticación, usuarios y terminales.
            const terminalsResponse = await fetch('/api/turso/store?table=terminales&limit=500', {
              credentials: 'include',
              cache: 'no-store',
            });
            if (!terminalsResponse.ok) {
              throw new Error('No se pudieron consultar los terminales en Turso.');
            }
            const terminalsBody = await terminalsResponse.json();
            const terminals = Array.isArray(terminalsBody?.records) ? terminalsBody.records as Terminal[] : [];
            const myTerm = terminals.find((t: Terminal) =>
              String(t?.usuarioId || '') === String(currentUser.id)
            );
            if (!myTerm) {
              await fetch('/api/auth/logout', { method: 'POST' });
              alert("ACCESO RESTRINGIDO: Su usuario no tiene un terminal asignado.");
              router.push('/login');
              return;
            }

            // La identidad operativa de un cajero queda fijada al terminal
            // resuelto en Turso. No dependemos de un uid heredado/Firebase
            // para volver a encontrar la caja después de un Z y una nueva
            // apertura.
            const profileWithTerminal = { ...profile, terminalId: String(myTerm.id) };
            setUserProfile(profileWithTerminal);
            setUser({ uid: legacyUid, email: currentUser.email, ...currentUser, terminalId: String(myTerm.id) });
            setState(prev => ({ ...prev, user: profileWithTerminal, isAuthenticated: true } as AppState));

            if (myTerm.id) Store.startTerminalSync(myTerm.id, false, [myTerm]);

            // Regla de continuidad de caja:
            // - Sin corte Z => isCashOpen=true: NO se crea una nueva apertura.
            //   Se recupera la jornada existente y se conservan sus ventas,
            //   movimientos y demás registros persistidos en Turso.
            // - Con corte Z / caja cerrada => isCashOpen=false: se exige una
            //   nueva apertura antes de entrar al POS.
            //
            // El estado de caja vive en el documento de la terminal, no en
            // sessionStorage/localStorage; por eso un reinicio/corte de luz
            // no debe convertir una jornada abierta en una jornada nueva.
            const jornadaAbierta = myTerm.isCashOpen === true;
            setShowApertura(!jornadaAbierta);
            setActiveTab('ventas');
          } else {
            Store.startTerminalSync(undefined, true);
            setShowApertura(false);

            // Un administrador nunca entra al POS/caja, aunque esta pestaña
            // conserve de una sesión anterior el módulo "ventas".
            // La caja es exclusiva del rol cajero.
            const savedModule = sessionStorage.getItem('posven_active_module') || 'dashboard';
            const safeModule = savedModule === 'ventas' ? 'dashboard' : savedModule;
            if (safeModule !== savedModule) {
              sessionStorage.setItem('posven_active_module', safeModule);
            }
            setActiveTab(safeModule);
          }
          setLoading(false);
          return;
        }
        if (response.status !== 503) {
          router.push('/login');
          return;
        }
      } catch {}


    };

    initializeFromTurso();

    const unsubscribeStore = Store.subscribe((dbUpdate: Partial<AppState>) => {
      // La sesión autenticada por Turso es la autoridad para usuario/terminal.
      // El cache local del Store puede contener un usuario histórico y no debe
      // reemplazar el terminalId resuelto al iniciar sesión.
      const { user: _cachedUser, isAuthenticated: _cachedAuth, ...dbPatch } = dbUpdate as any;
      setState(prev => ({ ...prev, ...dbPatch }) as AppState);
    });
    const timerClock = setInterval(() => setCurrentTime(new Date()), 1000);
    const runtimeHeartbeat = setInterval(() => {
      try {
        const raw = localStorage.getItem('posven_runtime_marker');
        if (!raw) return;
        const marker = JSON.parse(raw);
        localStorage.setItem('posven_runtime_marker', JSON.stringify({ ...marker, heartbeatAt: new Date().toISOString() }));
      } catch {}
    }, 15000);
    const clearRuntimeMarker = () => { try { localStorage.removeItem('posven_runtime_marker'); } catch {} };
    window.addEventListener('beforeunload', clearRuntimeMarker);

    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      const hOnline = () => setIsOnline(true);
      const hOffline = () => setIsOnline(false);
      window.addEventListener('online', hOnline);
      window.addEventListener('offline', hOffline);
      return () => {
        unsubscribeStore();
        clearInterval(timerClock);
        clearInterval(runtimeHeartbeat);
        window.removeEventListener('beforeunload', clearRuntimeMarker);
        clearTimeout(timerSafety);
        document.removeEventListener('click', preventCriticalDoubleClick, true);
        window.removeEventListener('error', captureError);
        window.removeEventListener('online', hOnline);
        window.removeEventListener('offline', hOffline);
      };
    }

    return () => {
      unsubscribeStore();
      clearInterval(timerClock);
      clearInterval(runtimeHeartbeat);
      window.removeEventListener('beforeunload', clearRuntimeMarker);
      clearTimeout(timerSafety);
      window.removeEventListener('error', captureError);
    };
  }, [router]);

  // Maestros bajo demanda: solo mantienen realtime mientras el módulo que los necesita está abierto.
  // El sincronizador conserva el listener si el siguiente módulo también lo necesita,
  // evitando repetir el snapshot completo de clientes/proveedores al navegar.
  useEffect(() => {
    const clientesModules = new Set(['dashboard', 'ventas', 'cxc']);
    const proveedoresModules = new Set(['dashboard', 'compras', 'proveedores', 'cxp']);
    const wanted: string[] = [];
    if (clientesModules.has(activeModule)) wanted.push('clientes');
    if (proveedoresModules.has(activeModule)) wanted.push('proveedores');
    Store.syncMasterSync(wanted);
  }, [activeModule]);

  // LÓGICA DE NOTIFICACIONES CXP (CADA 6 HORAS / 72H VENCIMIENTO)
  useEffect(() => {
    if (!state.cxp || state.cxp.length === 0 || userRole !== 'administrador') return;

    const checkDueDebts = () => {
      const now = new Date();
      const limitDate = new Date();
      limitDate.setHours(limitDate.getHours() + 72); // 72 horas desde ahora

      const pending = state.cxp.filter(d => {
        if (d.estado === 'pagada' || (d.saldoUSD || 0) <= 0.001) return false;
        const dueDate = new Date(d.fechaVencimiento + 'T23:59:59');
        return dueDate <= limitDate;
      });

      setDueDebts(pending);

      if (pending.length > 0) {
        const lastAlert = localStorage.getItem('posven_last_cxp_alert');
        const sixHours = 6 * 60 * 60 * 1000;
        
        if (!lastAlert || (Date.now() - parseInt(lastAlert)) > sixHours) {
          setShowCxPAlert(true);
        }
      }
    };

    checkDueDebts();
    const interval = setInterval(checkDueDebts, 60000); // Revisar cada minuto internamente
    return () => clearInterval(interval);
  }, [state.cxp, userRole]);

  // El carrito es estrictamente local a la jornada/pantalla.
  // No se restaura desde sessionStorage al recargar: evita que productos de una
  // sesión anterior aparezcan automáticamente al abrir/refrescar una caja.
  useEffect(() => {
    if (mounted) sessionStorage.removeItem('posven_current_cart');
  }, [mounted]);

  useEffect(() => {
    if (mounted && activeModule) {
      sessionStorage.setItem('posven_active_module', activeModule);
    }
  }, [activeModule, mounted]);

  const handleLogout = async () => {
    if (confirm('¿Cerrar sesión del sistema?')) {
      setLoading(true);
      try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(POSVEN_TAB_SESSION_KEY);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        router.push('/login');
      } catch (e) {
        router.push('/login');
      }
    }
  };

  const updateState = (newState: Partial<AppState>) => {
    setState(prev => {
      const updated = { ...prev, ...newState } as AppState;
      Store.set(newState);
      return updated;
    });
  };

  const handleModuleChange = (moduleId: string) => {
    // Regla estricta: el POS/caja solo existe para el rol cajero.
    // Un administrador no puede llegar a "ventas" ni siquiera por navegación
    // residual de sessionStorage o una invocación accidental del handler.
    if (userRole === 'cajero' && moduleId !== 'ventas') return;
    if (userRole === 'administrador' && moduleId === 'ventas') return;
    setActiveTab(moduleId);
    setIsSidebarOpen(false);
  };

  const markAlertAsRead = () => {
    localStorage.setItem('posven_last_cxp_alert', Date.now().toString());
    setShowCxPAlert(false);
  };

  const menuGroups = [
    {
      id: 'operaciones',
      label: 'Operaciones',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'inventario', label: 'Inventario', icon: Package, count: (state.productos || []).filter((p: any) => p.activo).length },
        { id: 'compras', label: 'Entradas (Compras)', icon: ShoppingBag },
        { id: 'proveedores', label: 'Proveedores', icon: Truck, count: (state.proveedores || []).length },
      ]
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      items: [
        { id: 'contabilidad', label: 'Contabilidad', icon: BookOpen },
        { id: 'cxc', label: 'Cuentas por Cobrar', icon: HandCoins, count: (state.cxc || []).filter((x: any) => x.estado !== 'pagada').length },
        { id: 'cxp', label: 'Cuentas por Pagar', icon: FileText, count: (state.cxp || []).filter((x: any) => x.estado !== 'pagada').length },
      ]
    },
    {
      id: 'sistema',
      label: 'Sistema',
      items: [
        { id: 'reportes', label: 'Reportes', icon: BarChart3 },
        { id: 'config', label: 'Configuración', icon: Settings },
        { id: 'usuarios', label: 'Usuarios', icon: Users },
        { id: 'global_control', label: 'Global Control', icon: ShieldCheck },
      ]
    }
  ];

  const renderModule = () => {
    if (!mounted || loading || !activeModule) return null;
    switch (activeModule) {
      case 'dashboard': return <DashboardModule state={state} />;
      case 'inventario': return <InventoryModule state={state} updateState={updateState} />;
      case 'ventas':
        // Defensa final de UI: aunque el estado de navegación quedara
        // contaminado por una sesión previa, un administrador jamás renderiza
        // el módulo POS/caja.
        if (userRole !== 'cajero') return <DashboardModule state={state} />;
        return <SalesModule state={state} updateState={updateState} />;
      case 'compras': return <PurchaseModule state={state} updateState={updateState} />;
      case 'proveedores': return <SuppliersModule state={state} updateState={updateState} />;
      case 'contabilidad': {
        const ids = [user?.id, user?.uid, user?.firebaseUid].filter(Boolean).map(String);
        const terminal = state.terminales.find(t => ids.includes(String(t.usuarioId || '')));
        return <AccountingModule state={state} updateState={updateState} terminalId={terminal?.id} terminalName={terminal?.nombre} />;
      }
      case 'cxc': return <CxCModule state={state} updateState={updateState} terminalId={state.terminales.find(t => t.usuarioId === user?.uid)?.id} />;
      case 'cxp': return <CxPModule state={state} updateState={updateState} terminalId={state.terminales.find(t => t.usuarioId === user?.uid)?.id} />;
      case 'reportes': return <ReportsModule state={state} />;
      case 'config': return <ConfigModule state={state} updateState={updateState} />;
      case 'usuarios': return <UsersModule />;
      case 'global_control': return <GlobalControlModule state={state} updateState={updateState} />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-brand-gold/20 border-t-brand-gold rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">Iniciando PosVEN Pro...</p>
        </div>
      </div>
    );
  }

  const isCajero = userRole === 'cajero';

  if (showApertura && isCajero) {
    const timeStr = mounted ? currentTime.toLocaleTimeString('es-VE', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/Caracas' 
    }) : '--:--:--';
    const dateStr = mounted ? currentTime.toLocaleDateString('es-VE', { 
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Caracas'
    }) : '...';

    const appUser: any = (state as any).user || user || null;
    const userIds = [
      appUser?.id,
      appUser?.uid,
    ].filter(Boolean).map(String);
    const terminalActual = appUser?.terminalId
      ? state.terminales.find(t => String(t.id) === String(appUser.terminalId))
      : state.terminales.find(t => userIds.includes(String(t.usuarioId || '')));
    const nextRecibo = terminalActual?.proximoRecibo || state.proximoRecibo;
    const prefijoRecibo = Utils.prefijoCaja(terminalActual, state.terminales);

    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center p-6 font-sans no-print">
         <div className="w-full max-w-[480px] bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] p-10 space-y-6 animate-in fade-in zoom-in duration-500 border border-line">
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-10 h-10 bg-brand-gold rounded-xl flex items-center justify-center text-black font-black text-xl shadow-lg">P</div>
                <div className="font-display font-black text-xl text-ink tracking-tighter uppercase">Pos<span className="text-brand-gold">VEN</span> Pro</div>
              </div>
              <div className="h-0.5 w-10 bg-brand-gold rounded-full mx-auto mb-2"></div>
              <h1 className="text-base font-extrabold text-ink tracking-tight uppercase italic">Apertura de Jornada</h1>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Terminal</label>
                  <p className="text-[10px] font-black text-brand-gold-deep uppercase truncate">{terminalActual?.nombre || 'S/T'}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Responsable</label>
                  <p className="text-[10px] font-black text-ink uppercase truncate">{userProfile?.nombre || 'Operador'}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Recibo Inicio</label>
                  <p className="text-[10px] font-black text-ink"># {prefijoRecibo}-{String(nextRecibo).padStart(9, '0')}</p>
                </div>
              </div>

              <div className="p-3 bg-ink text-white rounded-xl flex justify-between items-center">
                <div className="space-y-0.5">
                  <label className="text-[8px] font-bold uppercase opacity-50 block tracking-widest">Fecha</label>
                  <p className="text-[9px] font-black uppercase">{dateStr}</p>
                </div>
                <div className="text-right space-y-0.5">
                  <label className="text-[8px] font-bold uppercase opacity-50 block tracking-widest">Hora</label>
                  <p className="text-[9px] font-black uppercase">{timeStr}</p>
                </div>
              </div>

              <div className="space-y-4">
                 <div className="form-group">
                    <label className="text-ink text-[9px] font-black uppercase block mb-1.5 opacity-70">Fondo Efectivo Bs.</label>
                    <input type="text" className="form-input h-11 text-lg font-black text-center text-ink bg-surface-soft/40 border-line" value={aperturaData.bs} onChange={e => setAperturaData({...aperturaData, bs: e.target.value.replace(/[^0-9.]/g, '')})} />
                 </div>
                 <div className="form-group">
                    <label className="text-ink text-[9px] font-black uppercase block mb-1.5 opacity-70">Fondo Efectivo USD</label>
                    <input type="text" className="form-input h-11 text-lg font-black text-center text-brand-gold-deep bg-surface-soft/40 border-line" value={aperturaData.usd} onChange={e => setAperturaData({...aperturaData, usd: e.target.value.replace(/[^0-9.]/g, '')})} />
                 </div>
              </div>

              <button 
                disabled={aperturaData.bs === '' || aperturaData.usd === ''} 
                onClick={() => { 
                  const bsValue = parseFloat(aperturaData.bs) || 0;
                  const usdValue = parseFloat(aperturaData.usd) || 0;
                  
                  // ✅ GUARDAR LA APERTURA EN EL TERMINAL (caja) DE ESTE OPERADOR,
                  // no en un estado global. Cada caja abre/cierra su propia jornada.
                  const currentState = Store.get();
                  // La identidad de caja viene de la sesión Turso resuelta al iniciar
                  // sesión. Store puede conservar un usuario cacheado antiguo, por lo
                  // que nunca debemos usarlo por encima de la identidad React actual.
                  const currentUser: any = user || (state as any).user || (currentState as any).user || null;
                  const sessionTerminalId = String(
                    currentUser?.terminalId ||
                    (state as any).user?.terminalId ||
                    (currentState as any).user?.terminalId ||
                    ''
                  ).trim();
                  const currentIds = [currentUser?.id, currentUser?.uid]
                    .filter(Boolean).map(String);
                  const termId = sessionTerminalId || (
                    (currentState.terminales || [])
                      .find(t => currentIds.includes(String(t.usuarioId || '')))?.id || ''
                  );
                  if (!termId) {
                    alert('No se pudo identificar la caja asignada en Turso. No se puede abrir una caja global.');
                    return;
                  }
                  const terminalActual = (currentState.terminales || []).find(t => String(t.id) === String(termId));
                  const session: any = {
                    terminalId: termId,
                    terminalName: terminalActual?.nombre || 'S/T',
                    openDate: new Date().toISOString(),
                    openAmount: bsValue,
                    openAmountBs: bsValue,
                    openAmountUsd: usdValue,
                    openNotes: 'Apertura de jornada',
                    closeDate: null,
                    closeAmount: null,
                    closeAmountBs: null,
                    closeAmountUsd: null,
                    closeNotes: null,
                    totalSales: 0,
                    totalSalesBs: 0,
                    totalSalesUsd: 0,
                    totalCollections: 0,
                    saleCount: 0
                  };
                  const updatedTerminals = (currentState.terminales || []).map(t =>
                    t.id === termId ? { ...t, fondoCajaHoyBS: bsValue, fondoCajaHoyUSD: usdValue, isCashOpen: true, cashData: session } : t
                  );
                  // Mantener la identidad operativa de Turso al salir de la apertura.
                  // currentState puede contener un usuario cacheado antiguo sin terminalId;
                  // si lo copiamos completo a React, el POS pierde la caja inmediatamente
                  // después de confirmar la apertura y vuelve a mostrar "caja no disponible".
                  const authoritativeUser = {
                    ...(currentUser || {}),
                    terminalId: termId
                  };
                  const newState: AppState = {
                    ...currentState,
                    user: authoritativeUser,
                    terminales: updatedTerminals
                  };
                  Store.set({
                    user: authoritativeUser,
                    terminales: updatedTerminals
                  });
                  setUser(authoritativeUser);
                  setUserProfile(authoritativeUser);
                  setState(newState);
                  
                  localStorage.removeItem('posven_apertura_done');
                  setShowApertura(false); 
                }} 
                className="w-full h-14 bg-brand-gold text-ink font-black text-sm rounded-xl shadow-xl shadow-brand-gold/10 hover:bg-brand-gold-deep hover:text-white transition-all uppercase tracking-widest"
              >
                Confirmar Apertura
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full h-11 bg-white text-status-danger border-2 border-status-danger/20 font-black text-[10px] rounded-xl hover:bg-status-danger hover:text-white transition-all uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                REGRESAR AL LOGIN
              </button>
            </div>
         </div>
      </div>
    );
  }

  const timeStr = mounted ? currentTime.toLocaleTimeString('es-VE', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/Caracas' 
  }) : '--:--:--';

  const dateStr = mounted ? currentTime.toLocaleDateString('es-VE', { 
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Caracas'
  }) : '...';

  return (
    <div className="flex min-h-screen bg-surface-warm text-ink overflow-hidden">
      <aside 
        onMouseLeave={() => setIsSidebarOpen(false)}
        className={`fixed top-0 left-0 w-[260px] h-screen bg-white border-line flex flex-col z-50 transition-all duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} border-r shadow-2xl`}
      >
        <div className="p-6 border-b border-line flex flex-col gap-1 relative">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-ink border border-brand-gold rounded-[10px] flex items-center justify-center font-black text-brand-gold text-lg shadow-sm">P</div>
            <div>
              <div className="font-display font-[800] text-lg leading-none text-ink">Pos<span className="text-brand-gold">VEN</span> Pro</div>
              <div className="text-[0.68rem] font-bold text-ink uppercase tracking-widest mt-1">Soluciones Venezuela</div>
            </div>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-line rounded-full flex items-center justify-center text-ink hover:text-brand-gold shadow-sm"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {menuGroups.map((group) => (
            <div key={group.id} className="space-y-1">
              <div className="px-2.5 mb-2 text-[0.66rem] font-bold text-ink uppercase tracking-[0.18em]">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeModule === item.id;
                  return (
                    <button key={item.id} onClick={() => handleModuleChange(item.id)} className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-[10px] text-[0.9rem] font-bold transition-all group relative ${active ? 'bg-brand-gold-soft text-brand-gold-deep' : 'text-ink hover:bg-surface-soft hover:text-ink'}`}>
                      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-brand-gold rounded-r-full" />}
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${active ? 'text-brand-gold-deep' : 'text-ink group-hover:text-ink'}`} />
                        {item.label}
                      </div>
                      {item.count !== undefined && (
                        <span className={`px-2 py-0.5 rounded-full text-[0.7rem] font-black ${active ? 'bg-brand-gold text-white' : 'bg-surface-soft text-ink'}`}>{item.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        
        <div className="p-4 border-t border-line bg-surface-warm/50 flex flex-col gap-2">
          <div className="bg-brand-gold-soft border border-[#EFD9A4] rounded-lg p-3 flex items-center gap-3 shadow-sm">
            <div className="flex-1">
              <div className="text-[0.62rem] font-bold text-brand-gold-deep uppercase tracking-widest mb-1 leading-none">Tasa BCV</div>
              <div className="font-display font-[800] text-sm text-ink">{state.tasa.toFixed(2)} <span className="text-[0.7rem] font-black opacity-60">Bs/USD</span></div>
            </div>
          </div>
          
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[0.8rem] font-black text-status-danger hover:bg-status-danger-soft transition-all uppercase tracking-widest">
            <LogOut className="w-4 h-4" /> Cerrar Sistema
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen min-w-0 w-0 max-w-full overflow-hidden">
        <header className="sticky top-0 z-30 bg-surface-warm/85 backdrop-blur-md border-b border-line px-3 sm:px-7 py-3.5 flex items-center gap-2 sm:gap-6 no-print min-w-0 overflow-hidden">
          {!isCajero && (
            <button className="p-2 -ml-2 text-ink hover:text-brand-gold" onClick={() => setIsSidebarOpen(true)}>
              <Menu className="w-[20px] h-[20px]" />
            </button>
          )}
          
          <div className="shrink-0 min-w-0">
            <h2 className="font-display text-lg font-[800] text-ink leading-tight">Pos<span className="text-brand-gold">VEN</span> pro</h2>
            <p className="text-[0.7rem] text-ink uppercase font-bold tracking-widest">{isCajero ? 'Terminal de Punto de Venta' : 'Soluciones Venezuela'}</p>
          </div>

          <div className="hidden md:flex items-center gap-4 mx-auto">
            <div className="flex items-center gap-2.5 px-4 py-2 bg-white/70 rounded-xl border border-line shadow-sm min-w-[160px]">
              <div className="w-8 h-8 bg-brand-gold-soft rounded-lg flex items-center justify-center"><ClockIcon className="w-4 h-4 text-brand-gold-deep" /></div>
              <div className="flex flex-col">
                <span className="text-[0.65rem] font-black uppercase text-ink opacity-50 leading-none mb-0.5">{dateStr}</span>
                <span className="text-[0.88rem] font-black text-ink leading-none tabular-nums">{timeStr}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-4 py-2 bg-white/70 rounded-xl border border-line shadow-sm">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mounted && isOnline ? 'bg-status-success-soft' : 'bg-status-danger-soft'}`}>
                {mounted && isOnline ? <Wifi className="w-4 h-4 text-status-success" /> : <WifiOff className="w-4 h-4 text-status-danger" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[0.65rem] font-black uppercase text-ink opacity-50 leading-none mb-0.5">Cloud Sync</span>
                <div className="flex items-center gap-1.5 leading-none">
                  <div className={`w-1.5 h-1.5 rounded-full ${mounted ? (isOnline ? 'bg-status-success animate-pulse' : 'bg-status-danger') : 'bg-ink/20'}`} />
                  <span className={`text-[0.74rem] font-black uppercase ${mounted ? (isOnline ? 'text-status-success' : 'text-status-danger') : 'text-ink/20'}`}>{mounted ? (isOnline ? 'En Línea' : 'Modo Offline') : 'Iniciando...'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {!isCajero && (
              <button 
                onClick={() => dueDebts.length > 0 && setShowCxPAlert(true)}
                className="relative w-[38px] h-[38px] rounded-[10px] bg-white border border-line flex items-center justify-center text-ink hover:text-brand-gold transition-colors shadow-sm-card"
              >
                <Bell className={`w-4 h-4 ${dueDebts.length > 0 ? 'text-brand-gold animate-bounce' : ''}`} />
                {dueDebts.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-status-danger text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-white">
                    {dueDebts.length}
                  </span>
                )}
              </button>
            )}
            
            <div className="flex items-center gap-2.5 pl-3 border-l border-line ml-1">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-bold text-ink leading-none">{userProfile?.nombre || 'Usuario'}</div>
                <div className="text-[0.66rem] font-bold text-ink opacity-60 uppercase mt-1 tracking-wider">{userRole === 'administrador' ? 'Panel Control' : 'Modo Operativo'}</div>
              </div>
              <div className="w-[34px] h-[34px] rounded-full bg-gradient-to-br from-brand-gold to-[#E7B857] flex items-center justify-center text-white font-black text-xs border border-white/20 shadow-sm uppercase">{userProfile?.nombre?.charAt(0) || 'U'}</div>
            </div>
            
            <button onClick={handleLogout} className="w-10 h-10 bg-status-danger-soft text-status-danger rounded-xl flex items-center justify-center hover:bg-status-danger hover:text-white transition-all shadow-sm" title="Cerrar Sistema"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>
        
        <div className="p-3 sm:p-7 flex-1 min-w-0 overflow-x-hidden overflow-y-auto">{renderModule()}</div>

        <footer className="px-8 py-6 border-t border-line text-[0.76rem] font-black text-ink flex flex-col sm:flex-row justify-between gap-4 no-print bg-surface-warm/30">
          <div>© 2026 PosVEN Pro · Persistencia Offline Activa</div>
          <div className="flex gap-4 items-center">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-status-success animate-pulse' : 'bg-status-warn'}`} /> {isOnline ? 'Nube Sincronizada' : 'Sincronización Pendiente'}
            </span>
            <span className="px-2 py-0.5 bg-white border border-line rounded text-[0.65rem] font-black">v2.5.6-resilient</span>
          </div>
        </footer>
      </main>

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-[45] backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* CARTEL DE NOTIFICACIÓN CXP (CENTRAL) */}
      {showCxPAlert && (
        <div className="modal show" style={{ zIndex: 9999 }}>
          <div className="modal-bg" />
          <div className="modal-box max-w-lg bg-white border-2 border-line rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in duration-300">
            <div className="modal-head py-5 px-8 bg-ink border-b border-white/10 flex justify-between items-center text-white">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-gold rounded-xl flex items-center justify-center text-black shadow-lg">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm uppercase italic tracking-widest">Alerta de Vencimiento</h3>
                    <p className="text-[9px] font-bold text-white/40 uppercase tracking-tighter">Compromisos con Proveedores</p>
                  </div>
               </div>
               <button onClick={markAlertAsRead} className="text-white/20 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-8 space-y-6 bg-white max-h-[60vh] overflow-y-auto">
               <div className="p-4 bg-status-danger-soft border border-status-danger/20 rounded-2xl">
                 <p className="text-[11px] font-bold text-status-danger uppercase leading-tight text-center">
                   Usted tiene {dueDebts.length} facturas por pagar que vencen en menos de 72 horas.
                 </p>
               </div>

               <div className="space-y-3">
                 {dueDebts.map(d => {
                   const diff = new Date(d.fechaVencimiento + 'T23:59:59').getTime() - Date.now();
                   const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                   return (
                     <div key={d.id} className="p-4 bg-surface-soft border border-line rounded-2xl flex items-center justify-between group hover:border-brand-gold transition-all">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-ink uppercase">{d.proveedor}</p>
                          <div className="flex items-center gap-2">
                             <span className="badge badge-neutral text-[8px] font-black uppercase">Ref: {d.numeroFactura || d.id.slice(-6)}</span>
                             <span className="flex items-center gap-1 text-[9px] font-bold text-status-danger uppercase">
                               <Calendar className="w-3 h-3" /> Vence en {days} {days === 1 ? 'día' : 'días'}
                             </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-ink">{Utils.fmtUSD(d.saldoUSD)}</p>
                          <p className="text-[9px] font-bold text-ink/40 uppercase italic">Saldo Pendiente</p>
                        </div>
                     </div>
                   );
                 })}
               </div>

               <div className="bg-brand-gold-soft/30 p-4 rounded-2xl border border-brand-gold/10">
                 <p className="text-[9px] font-bold text-brand-gold-deep uppercase leading-relaxed text-center italic">
                   Este recordatorio volverá a aparecer en 6 horas para asegurar la liquidez de sus compromisos.
                 </p>
               </div>
            </div>
            <div className="modal-foot p-6 bg-surface-soft border-t border-line">
               <button 
                onClick={markAlertAsRead}
                className="w-full h-14 bg-brand-gold text-black font-black text-sm rounded-2xl shadow-xl shadow-brand-gold/10 hover:bg-brand-gold-deep hover:text-white transition-all uppercase tracking-widest flex items-center justify-center gap-3"
               >
                 <CheckCircle2 className="w-5 h-5" /> Entendido, Revisaré los pagos
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}