'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AppState } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { Save, AlertTriangle, RefreshCw, Database, Activity, BookOpen, PenLine, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { crearRespaldo, descargarRespaldo, cargarRespaldoDesdeArchivo } from '@/lib/backup';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      toast({ title: "Sincronizado", description: "Tasa de cambio guardada en Turso y disponible después de recargar." });
    } catch (error: any) {
      console.error('Error guardando tasa en Turso:', error);
      toast({ variant: 'destructive', title: 'No se guardó la tasa', description: error?.message || 'Turso no confirmó el cambio.' });
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

  const handleArchivoRespaldo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError(null);
    setBackupProgress(null);

    const confirmar = window.confirm('Se restaurará el sistema completo desde este respaldo. Los datos actuales serán reemplazados. ¿Desea continuar?');
    if (!confirmar) return;

    setIsRestoringBackup(true);
    setBackupProgress({ percent: 0, stage: 'Preparando', detail: 'Leyendo y validando el archivo…' });

    try {
      await cargarRespaldoDesdeArchivo(file, (progress) => setBackupProgress(progress));
      toast({ title: "Respaldo Restaurado", description: "La restauración terminó correctamente. Se recomienda recargar la aplicación." });
    } catch (err: any) {
      console.error('❌ Error restaurando respaldo:', err);
      setBackupError(err?.message || 'No se pudo cargar el respaldo seleccionado.');
      setBackupProgress(null);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleRepararCxcMigrado = async () => {
    const confirmar = window.confirm(
      'REPARAR CxC MIGRADO\n\n' +
      'Se revisarán las cuentas por cobrar existentes en Turso y se sincronizarán con la venta/factura original cuando exista.\n\n' +
      'La reparación NO modifica pagos, abonos ni saldo pendiente.\n\n' +
      '¿Desea continuar?'
    );
    if (!confirmar) return;

    setIsRepairingCxc(true);
    setReparacionCxcResultado(null);
    try {
      const response = await fetch('/api/turso/repair-cxc', {
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
    const confirmMsg = '⚠️ Esta acción eliminará los datos operativos almacenados en Turso. El administrador semilla se conservará. ¿Desea continuar?';
    if (!confirm(confirmMsg)) return;
    setIsFormatting(true);
    try {
      const response = await fetch('/api/turso/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ operation: 'factoryReset' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Turso no confirmó el formateo.');
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('posven_apertura_done');
        localStorage.removeItem('posven_last_cxp_alert');
      }
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      toast({ title: 'Sistema Formateado', description: 'Turso fue reiniciado y el administrador semilla fue conservado.' });
      window.location.href = '/login';
    } catch (error: any) {
      console.error('Error en formateo Turso:', error);
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

      {/* ===== MANTENIMIENTO TURSO ===== */}
      <div className="card shadow-lg border-amber-500/30 bg-amber-50 border-2">
        <div className="card-head border-b border-amber-500/20 px-5 py-4">
          <h3 className="text-amber-800 font-black uppercase italic text-xs flex items-center gap-2">
            <Database className="w-4 h-4" /> Mantenimiento Turso
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              onClick={() => fileInputRef.current?.click()}
              disabled={isRestoringBackup}
            >
              {isRestoringBackup ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isRestoringBackup ? 'RESTAURANDO...' : 'Cargar Respaldo'}
            </button>
          </div>

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