'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AppState } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { Save, AlertTriangle, RefreshCw, Database, Activity, BookOpen, PenLine, Trash2, Wifi, WifiOff, Network } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { crearRespaldo, descargarRespaldo, cargarRespaldoDesdeContenido, detectarRespaldoTursoTruncado, previsualizarCatalogosDesdeArchivo, importarCatalogosDesdeArchivo, type BackupFile } from '@/lib/backup';

export default function ConfigModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [tasa, setTasa] = useState<string | number>(state.tasa);
  const [empresa, setEmpresa] = useState(state.empresa);
  const [pinDevolucion, setPinDevolucion] = useState(state.pinDevolucion || '');
  const [isFormatting, setIsFormatting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isRepairingCxc, setIsRepairingCxc] = useState(false);
  const [reparacionCxcResultado, setReparacionCxcResultado] = useState<any>(null);
  const [migracionResultado, setMigracionResultado] = useState<any>(null);
  const [showMigracionResultado, setShowMigracionResultado] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupProgress, setBackupProgress] = useState<{ percent: number; stage: string; detail: string } | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [isImportingCatalogs, setIsImportingCatalogs] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<any>(null);
  const [networkError, setNetworkError] = useState('');
  const [openingNetworkSettings, setOpeningNetworkSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catalogFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (typeof api?.getNetworkInfo !== 'function') return;
    api.getNetworkInfo()
      .then((info: any) => setNetworkInfo(info))
      .catch((error: any) => setNetworkError(error?.message || 'No se pudo consultar la configuración LAN.'));
  }, []);

  const abrirConfiguracionLAN = async () => {
    const api = (window as any).electronAPI;
    if (typeof api?.openNetworkSettings !== 'function') {
      setNetworkError('El panel de red LAN está disponible en la aplicación de escritorio POSVEN-Pro.');
      return;
    }
    setOpeningNetworkSettings(true);
    setNetworkError('');
    try {
      await api.openNetworkSettings();
    } catch (error: any) {
      setNetworkError(error?.message || 'No se pudo abrir la configuración de red LAN.');
    } finally {
      setOpeningNetworkSettings(false);
    }
  };

  useEffect(() => {
    setTasa(state.tasa);
    setEmpresa(state.empresa);
    setPinDevolucion(state.pinDevolucion || '000000');
  }, [state.tasa, state.empresa, state.pinDevolucion]);

  const guardarTasa = async () => {
    const n = parseFloat(tasa.toString());
    if (isNaN(n) || n <= 0) return alert('Tasa inválida');
    try {
      await Store.patchConfig({ tasa: n });
      toast({ title: "Sincronizado", description: "Tasa de cambio guardada en SQLite local y disponible después de recargar." });
    } catch (error: any) {
      console.error('Error guardando tasa en SQLite local:', error);
      toast({ variant: 'destructive', title: 'No se guardó la tasa', description: error?.message || 'SQLite local no confirmó el cambio.' });
    }
  };

  const guardarEmpresa = () => {
    updateState({ empresa });
    toast({ title: "Perfil Actualizado", description: "Los datos fiscales han sido guardados." });
  };

  const guardarPin = () => {
    if (pinDevolucion.length !== 6) return alert('El PIN debe ser de 6 dígitos exactos');
    updateState({ pinDevolucion });
    toast({ title: "Seguridad Actualizada", description: "PIN de autorización establecido correctamente." });
  };

  const handleCrearRespaldo = async () => {
    setIsBackingUp(true);
    setBackupError(null);
    try {
      const backup = await crearRespaldo();
      descargarRespaldo(backup);
      toast({ title: "Respaldo Creado", description: "El archivo .json con todos los datos se descargó correctamente." });
    } catch (e: any) {
      console.error(e);
      setBackupError(e?.message || 'No fue posible crear el respaldo.');
    } finally {
      setIsBackingUp(false);
    }
  };

  const restaurarContenidoRespaldo = async (content: string) => {
    setBackupError(null);
    setBackupProgress(null);
    const confirmar = window.confirm('Se restaurará el sistema completo desde este respaldo. Los datos actuales serán reemplazados. ¿Desea continuar?');
    if (!confirmar) return;

    let allowPartialTursoRestore = false;
    try {
      const parsed = JSON.parse(content) as BackupFile;
      if ((parsed as any)?.type === 'catalogs-only') {
        setBackupError('Este archivo es exclusivo de catálogos. Use «Importar solo catálogos» y no la restauración completa.');
        return;
      }
      const partial = detectarRespaldoTursoTruncado(parsed);
      if (partial.cappedTables.length) {
        const oldestDate = partial.oldestMovementDate || 'no identificable en el archivo';
        const movementCount = partial.movementCount.toLocaleString('es-VE');
        const warning =
          'ADVERTENCIA: RESTAURACIÓN PARCIAL DE HISTORIAL\n\n' +
          (partial.cappedTables.includes('movimientos')
            ? 'La tabla movimientos contiene ' + movementCount + ' registros y alcanza el límite de 10.000. El Kardex anterior al ' + oldestDate + ' podría faltar; la fecha más antigua incluida no demuestra que el historial comience allí.'
            : 'El manifiesto alcanza el límite de 10.000 registros en: ' + partial.cappedTables.join(', ') + '. Parte del historial de esas tablas podría faltar.') + '\n\n' +
          'La fotografía de existencias se restaurará desde los productos incluidos, pero NO se garantiza la integridad histórica del Kardex ni que estén presentes todos los movimientos anteriores.\n\n' +
          'Tablas afectadas: ' + partial.cappedTables.join(', ') + '.\n\n' +
          'Si continúa, acepta expresamente restaurar este respaldo incompleto. ¿Autoriza la restauración parcial?';
        allowPartialTursoRestore = window.confirm(warning);
        if (!allowPartialTursoRestore) {
          setBackupError('Restauración cancelada. No se modificó SQLite local porque no se autorizó la restauración parcial.');
          return;
        }
      }
    } catch (err: any) {
      setBackupError(err?.message || 'El respaldo no contiene JSON válido.');
      return;
    }

    setIsRestoringBackup(true);
    setBackupProgress({ percent: 0, stage: 'Preparando', detail: 'Leyendo y validando el archivo…' });
    try {
      await cargarRespaldoDesdeContenido(content, (progress) => setBackupProgress(progress), allowPartialTursoRestore);
      toast({ title: "Respaldo Restaurado", description: allowPartialTursoRestore
        ? "La restauración parcial SQLite terminó. El Kardex histórico anterior a la fecha indicada puede estar incompleto."
        : "La restauración SQLite terminó correctamente. La aplicación se actualizará ahora." });
      setTimeout(() => window.location.reload(), 900);
    } catch (err: any) {
      console.error('❌ Error restaurando respaldo:', err);
      setBackupError(err?.message || 'No se pudo cargar el respaldo seleccionado.');
      setBackupProgress(null);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleArchivoRespaldo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      await restaurarContenidoRespaldo(content);
    } catch (err: any) {
      setBackupError(err?.message || 'No se pudo leer el archivo seleccionado.');
    }
  };

  const handleSeleccionarRespaldo = async () => {
    const electronAPI = (window as any).electronAPI;
    if (typeof electronAPI?.selectBackupFile !== 'function') {
      fileInputRef.current?.click();
      return;
    }
    setIsRestoringBackup(true);
    setBackupError(null);
    try {
      const selected = await electronAPI.selectBackupFile();
      setIsRestoringBackup(false);
      if (!selected || selected.canceled) return;
      if (selected.error) throw new Error(selected.error);
      if (typeof selected.content !== 'string' || !selected.content) {
        throw new Error('No se pudo leer el contenido del respaldo seleccionado.');
      }
      await restaurarContenidoRespaldo(selected.content);
    } catch (err: any) {
      setBackupError(err?.message || 'No se pudo abrir el selector de respaldos.');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleImportarSoloCatalogos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsImportingCatalogs(true);
    setBackupError(null);
    try {
      const preview = await previsualizarCatalogosDesdeArchivo(file);
      const d = preview.plan.departamentos;
      const cat = preview.plan.categorias;
      const summary =
        'VISTA PREVIA DE IMPORTACIÓN SEGURA\\n\\n' +
        'DEPARTAMENTOS: ' + d.imported + ' en archivo; ' + d.before + ' actuales; ' + d.added + ' nuevos; total final ' + d.after + '.\\n' +
        'CATEGORÍAS: ' + cat.imported + ' en archivo; ' + cat.before + ' actuales; ' + cat.added + ' nuevas; total final ' + cat.after + '.\\n\\n' +
        'Solo se fusionarán departamentos y categorías. Productos, existencias, movimientos, ventas, compras, CxC, CxP y caja no serán modificados.\\n\\n' +
        '¿Confirmas la importación?';
      if (!window.confirm(summary)) return;
      const result = await importarCatalogosDesdeArchivo(file);
      updateState({ departamentos: result.catalogs.departamentos, categorias: result.catalogs.categorias });
      toast({ title: 'Catálogos recuperados', description: 'Se fusionaron departamentos y categorías en SQLite local. Los productos y movimientos permanecen intactos.' });
    } catch (error: any) {
      setBackupError(error?.message || 'No se pudo importar el JSON de catálogos.');
    } finally {
      setIsImportingCatalogs(false);
    }
  };

  const handleRepararCxcMigrado = async () => {
    const confirmar = window.confirm(
      'REPARAR CxC MIGRADO\n\n' +
      'Se revisarán las cuentas por cobrar existentes en SQLite local y se sincronizarán con la venta/factura original cuando exista.\n\n' +
      'La reparación NO modifica pagos, abonos ni saldo pendiente.\n\n' +
      '¿Desea continuar?'
    );
    if (!confirmar) return;

    setIsRepairingCxc(true);
    setReparacionCxcResultado(null);
    try {
      const response = await fetch('/api/pos/repair-cxc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'repair-cxc', confirm: 'REPARAR_CXC_MIGRADO' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || 'No fue posible reparar las cuentas por cobrar migradas.');
      }
      setReparacionCxcResultado(result);
      toast({
        title: 'CxC migrado revisado',
        description: 'Revisadas: ' + (result.revisadas || 0) + '. Corregidas: ' + (result.corregidas || 0) + '.'
      });
    } catch (error: any) {
      console.error('Error reparando CxC migrado:', error);
      setReparacionCxcResultado({ error: error?.message || 'No se pudo ejecutar la reparación.' });
      toast({ variant: 'destructive', title: 'Error en reparación CxC', description: error?.message || 'No se pudo ejecutar la reparación.' });
    } finally {
      setIsRepairingCxc(false);
    }
  };

  const formatearSistema = async () => {
    const confirmMsg = '⚠️ Esta acción eliminará los datos operativos almacenados en SQLite local. El administrador semilla se conservará. ¿Desea continuar?';
    if (!confirm(confirmMsg)) return;
    setIsFormatting(true);
    try {
      const response = await fetch('/api/pos/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ operation: 'factoryReset' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || 'SQLite local no confirmó el formateo.');
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('posven_apertura_done');
        localStorage.removeItem('posven_last_cxp_alert');
      }
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      toast({ title: 'Sistema Formateado', description: 'SQLite local fue reiniciado y el administrador semilla fue conservado.' });
      window.location.href = '/login';
    } catch (error: any) {
      console.error('Error en formateo SQLite local:', error);
      toast({ variant: 'destructive', title: 'Fallo en Limpieza', description: error?.message || 'No se pudo completar el formateo.' });
    } finally {
      setIsFormatting(false);
    }
  };

  // Función para obtener el valor seguro de resultados
  const getResultados = () => {
    if (!migracionResultado || !migracionResultado.success) {
      return null;
    }
    return migracionResultado.resultados || null;
  };

  const resultados = getResultados();

  return (
    <div className="max-w-2xl space-y-6 animate-in fade-in duration-300 pb-20">
      {/* ===== RED LAN ===== */}
      <div className="card shadow-lg border-blue-500/30">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest flex items-center gap-2">
            <Network className="w-4 h-4" /> Configuración de Red LAN
          </h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <p className="text-xs text-ink font-bold">
            Configura este equipo como servidor o cliente. Si el descubrimiento automático falla, puedes indicar manualmente la IP privada del servidor y el puerto. La base SQLite permanece únicamente en el servidor.
          </p>
          {networkInfo ? (
            <div className="rounded-xl border border-line bg-surface-soft/50 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black uppercase text-ink/60">Modo de este equipo</span>
                <span className="font-black uppercase text-brand-gold-deep">{networkInfo.mode === 'server' ? 'Servidor' : networkInfo.mode === 'client' ? 'Cliente' : 'No disponible'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-black uppercase text-ink/60">Puerto</span>
                <span className="font-mono font-bold">{networkInfo.port || 4580}</span>
              </div>
              {networkInfo.mode === 'server' && (
                <>
                  <div className="font-black uppercase text-ink/60 pt-1">Direcciones IP para las PCs clientes</div>
                  {(networkInfo.addresses || []).length ? networkInfo.addresses.map((ip: string) => (
                    <div key={ip} className="font-mono font-bold text-sm select-all">https://{ip}:{networkInfo.port || 4580}</div>
                  )) : <p className="text-amber-700">No se detectó una IP privada IPv4. Comprueba el adaptador de red.</p>}
                  {networkInfo.fingerprint && <div className="pt-2"><div className="font-black uppercase text-ink/60 mb-1">Huella TLS SHA-256 (compartir de forma segura)</div><div className="font-mono break-all select-all">{String(networkInfo.fingerprint).match(/.{1,2}/g)?.join(':')}</div></div>}
                </>
              )}
              {networkInfo.mode === 'client' && (
                <div className="flex items-center justify-between gap-2"><span className="font-black uppercase text-ink/60">Servidor configurado</span><span className="font-mono font-bold">{networkInfo.serverHost}:{networkInfo.port}</span></div>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink/60">Consultando configuración de red del equipo…</p>
          )}
          <button className="btn btn-primary h-12 px-6 font-black uppercase text-xs shadow-md flex items-center gap-2" onClick={abrirConfiguracionLAN} disabled={openingNetworkSettings}>
            {openingNetworkSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {openingNetworkSettings ? 'ABRIENDO CONFIGURACIÓN…' : 'Configurar servidor / IP de conexión'}
          </button>
          {networkError && <p className="text-xs text-red-700 font-bold" role="alert">{networkError}</p>}
          <p className="text-[11px] text-ink/60">Los cambios de IP, puerto o función servidor/cliente requieren reiniciar POSVEN-Pro. No eliminan ni modifican la base de datos.</p>
        </div>
      </div>

      {/* ===== TASA DE CAMBIO ===== */}      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Tasa de Cambio Oficial</h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <div className="form-group">
            <label className="text-ink text-[10px] font-black uppercase block mb-2 opacity-70">VALOR DE REFERENCIA: 1 USD =</label>
            <div className="flex items-center gap-4">
              <input 
                type="number" 
                step="0.01"
                className="form-input flex-1 h-12 text-xl font-black text-brand-gold-deep border-line bg-surface-soft/30 px-4" 
                value={tasa} 
                onChange={e => setTasa(e.target.value)} 
              />
              <span className="text-ink font-black text-sm uppercase tracking-tighter">Bolívares (BS)</span>
            </div>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md mt-2" onClick={guardarTasa}>
            <Save className="w-4 h-4" /> Guardar Tasa Actualizada
          </button>
        </div>
      </div>

      {/* ===== SEGURIDAD ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Seguridad de Operaciones</h3>
        </div>
        <div className="card-body p-6 bg-white">
          <div className="form-group">
            <label className="text-ink text-[10px] font-black uppercase block mb-2 opacity-70">PIN de Autorización (6 Dígitos)</label>
            <input 
              type="password" 
              maxLength={6}
              className="form-input h-14 text-2xl font-black text-brand-gold-deep border-line bg-surface-soft/30 text-center tracking-[0.5em]" 
              value={pinDevolucion} 
              onChange={e => setPinDevolucion(e.target.value.replace(/\D/g, ''))} 
            />
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md mt-4" onClick={guardarPin}>
            <Save className="w-4 h-4" /> Establecer PIN
          </button>
        </div>
      </div>

      {/* ===== DATOS FISCALES ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Datos de Identidad Fiscal</h3>
        </div>
        <div className="card-body p-6 space-y-5 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Nombre del Negocio</label>
              <input className="form-input h-10 font-bold border-line" value={empresa.nombre} onChange={e => setEmpresa({...empresa, nombre: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Número de RIF</label>
              <input className="form-input h-10 font-black border-line uppercase" value={empresa.rif} onChange={e => setEmpresa({...empresa, rif: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Teléfono de Contacto</label>
              <input className="form-input h-10 font-bold border-line" value={empresa.telefono} onChange={e => setEmpresa({...empresa, telefono: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Dirección Fiscal</label>
              <input className="form-input h-10 font-bold border-line uppercase" value={empresa.direccion} onChange={e => setEmpresa({...empresa, direccion: e.target.value})} />
            </div>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md" onClick={guardarEmpresa}>
            <Save className="w-4 h-4" /> Actualizar Empresa
          </button>
        </div>
      </div>

      {/* ===== MANTENIMIENTO SQLITE LOCAL ===== */}
      <div className="card shadow-lg border-amber-500/30 bg-amber-50 border-2">
        <div className="card-head border-b border-amber-500/20 px-5 py-4">
          <h3 className="text-amber-800 font-black uppercase italic text-xs flex items-center gap-2">
            <Database className="w-4 h-4" /> Mantenimiento SQLite local
          </h3>
        </div>
        <div className="card-body p-6 bg-white">
          <p className="text-xs text-ink font-bold mb-3">
            Revisa las cuentas por cobrar migradas y sincroniza sus ítems, factura y totales con la venta original. No modifica pagos, abonos ni saldo pendiente.
          </p>
          <button
            className="btn bg-amber-600 hover:bg-amber-700 text-white h-12 px-8 font-black uppercase text-xs shadow-xl flex items-center gap-2"
            onClick={handleRepararCxcMigrado}
            disabled={isRepairingCxc}
          >
            {isRepairingCxc ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {isRepairingCxc ? 'REPARANDO CxC...' : 'REPARAR CxC MIGRADO'}
          </button>
          {reparacionCxcResultado && (
            <div className={reparacionCxcResultado.error ? 'mt-3 p-4 rounded-lg border bg-red-50 border-red-500' : 'mt-3 p-4 rounded-lg border bg-amber-50 border-amber-400'}>
              {reparacionCxcResultado.error ? (
                <p className="text-xs text-red-700 font-bold">{reparacionCxcResultado.error}</p>
              ) : (
                <>
                  <h4 className="font-black uppercase text-xs text-amber-800 mb-2">Resultado de reparación CxC</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs text-ink">
                    <div className="flex justify-between"><span className="font-bold">Revisadas:</span><span>{reparacionCxcResultado.revisadas || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Corregidas:</span><span>{reparacionCxcResultado.corregidas || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Sin venta:</span><span>{reparacionCxcResultado.sinVenta || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Sin ítems en venta:</span><span>{reparacionCxcResultado.sinItemsVenta || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Sin cambios:</span><span>{reparacionCxcResultado.sinCambios || 0}</span></div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== RESPALDO DE DATOS ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest flex items-center gap-2">
            <Database className="w-4 h-4" /> Respaldo de Datos
          </h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <p className="text-xs text-ink font-bold">
            Cree un respaldo completo del sistema (inventario, ventas, cuentas por cobrar/pagar, clientes, proveedores, usuarios, terminales, catálogos y configuración) como archivo <code className="font-mono">.json</code>. Puede restaurarlo posteriormente en este mismo equipo o en otro.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md flex items-center gap-2"
              onClick={handleCrearRespaldo}
              disabled={isBackingUp}
            >
              {isBackingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isBackingUp ? 'PREPARANDO RESPALDO...' : 'Crear Respaldo'}
            </button>

            <button
              className="btn h-12 px-8 font-black uppercase text-xs shadow-md flex items-center gap-2 border border-line bg-surface-soft/50 hover:bg-surface-soft"
              onClick={handleSeleccionarRespaldo}
              disabled={isRestoringBackup}
            >
              {isRestoringBackup ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isRestoringBackup ? 'RESTAURANDO...' : 'Cargar Respaldo'}
            </button>

            <button
              className="btn h-12 px-6 font-black uppercase text-xs shadow-md flex items-center gap-2 border border-line bg-surface-soft/50 hover:bg-surface-soft"
              onClick={() => catalogFileInputRef.current?.click()}
              disabled={isRestoringBackup || isImportingCatalogs}
            >
              {isImportingCatalogs ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isImportingCatalogs ? 'IMPORTANDO...' : 'Importar solo catálogos'}
            </button>
          </div>

          <input
            ref={catalogFileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportarSoloCatalogos}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleArchivoRespaldo}
          />

          {backupProgress && (
            <div className="p-4 rounded-lg border border-blue-500 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-blue-800 font-black uppercase">{backupProgress.stage}</p>
                <p className="text-sm text-blue-900 font-black">{backupProgress.percent}%</p>
              </div>
              <div className="h-3 w-full rounded-full bg-blue-100 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${backupProgress.percent}%` }}
                />
              </div>
              <p className="text-xs text-blue-700 mt-2 font-bold">{backupProgress.detail}</p>
            </div>
          )}

          {backupError && (
            <div className="p-4 rounded-lg border bg-red-50 border-red-500">
              <p className="text-xs text-red-700 font-black uppercase">Error al cargar el respaldo</p>
              <p className="text-xs text-red-700 mt-1">{backupError}</p>
            </div>
          )}
        </div>
      </div>

      {/* ===== ZONA DE SEGURIDAD CRÍTICA ===== */}
      <div className="card border-status-danger/30 bg-status-danger-soft">
        <div className="card-head border-b border-status-danger/20 px-5 py-4">
          <h3 className="text-status-danger font-black uppercase italic text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Zona de Seguridad Crítica
          </h3>
        </div>
        <div className="card-body p-6">
          <p className="text-xs text-ink font-bold mb-5 uppercase">
            ESTA ACCIÓN ELIMINARÁ TODOS LOS DATOS DEL SISTEMA DE MANERA PERMANENTE.
          </p>
          <button 
            className="btn btn-danger h-12 px-8 font-black uppercase text-xs shadow-xl flex items-center gap-2" 
            onClick={formatearSistema}
            disabled={isFormatting}
          >
            {isFormatting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            {isFormatting ? 'FORMATEANDO...' : 'Limpiar Todo el Sistema'}
          </button>
        </div>
      </div>
    </div>
  );
}