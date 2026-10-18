'use client';

import React, { useState, useEffect } from 'react';
import { AppState } from '@/lib/types';
import { Save, AlertTriangle, RefreshCw, Database } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc, setDoc, writeBatch, query, limit } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { migrarEstructura } from '@/lib/migracion-firestore';

export default function ConfigModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [tasa, setTasa] = useState<string | number>(state.tasa);
  const [empresa, setEmpresa] = useState(state.empresa);
  const [pinDevolucion, setPinDevolucion] = useState(state.pinDevolucion || '');
  const [isFormatting, setIsFormatting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migracionResultado, setMigracionResultado] = useState<any>(null);
  const [showMigracionResultado, setShowMigracionResultado] = useState(false);

  useEffect(() => {
    setTasa(state.tasa);
    setEmpresa(state.empresa);
    setPinDevolucion(state.pinDevolucion || '000000');
  }, [state.tasa, state.empresa, state.pinDevolucion]);

  const guardarTasa = () => {
    const n = parseFloat(tasa.toString());
    if (isNaN(n)) return alert('Tasa inválida');
    updateState({ tasa: n });
    toast({ title: "Sincronizado", description: "Tasa de cambio actualizada en todos los terminales." });
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

  // ============================================================
  // FUNCIÓN PARA ELIMINAR UNA COLECCIÓN COMPLETA CON BATCH
  // ============================================================
  const deleteCollection = async (collectionPath: string, batchSize = 100) => {
    try {
      const colRef = collection(db, collectionPath);
      const snapshot = await getDocs(query(colRef, limit(batchSize)));

      if (snapshot.empty) {
        console.log(`✅ Colección "${collectionPath}" vacía o no existe.`);
        return;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      // Recursivamente eliminar el resto (si hay más de batchSize documentos)
      await deleteCollection(collectionPath, batchSize);
    } catch (error) {
      console.warn(`⚠️ Error al eliminar colección "${collectionPath}":`, error);
    }
  };

  const handleMigrar = async () => {
    if (!confirm('¿Estás seguro de que quieres migrar los datos a la nueva estructura?\n\nEsta acción:\n- Creará colecciones separadas para: config, catalogos, inventario, ventas, movimientos, terminales, proveedores, devoluciones\n- Los datos existentes se mantendrán en la estructura antigua también\n- No se eliminarán datos existentes')) {
      return;
    }

    setIsMigrating(true);
    setShowMigracionResultado(false);
    try {
      const result = await migrarEstructura();
      setMigracionResultado(result);
      setShowMigracionResultado(true);
      
      if (result.success && result.resultados) {
        toast({ 
          title: "✅ Migración exitosa", 
          description: `Se migraron ${result.resultados.inventario} productos, ${result.resultados.ventas} ventas, etc.` 
        });
      } else {
        toast({ 
          variant: "destructive", 
          title: "❌ Error en migración", 
          description: result.error || 'Error desconocido'
        });
      }
    } catch (error: any) {
      toast({ 
        variant: "destructive", 
        title: "❌ Error", 
        description: String(error) 
      });
    } finally {
      setIsMigrating(false);
    }
  };

  const formatearSistema = async () => {
    const confirmMsg = 
      '⚠️ ¿ESTÁ ABSOLUTAMENTE SEGURO?\n\n' +
      'ESTA ACCIÓN ELIMINARÁ PERMANENTEMENTE:\n' +
      '✅ TODOS los productos e inventario.\n' +
      '✅ TODAS las ventas y créditos.\n' +
      '✅ TODOS los clientes y proveedores.\n' +
      '✅ TODOS los movimientos y asientos contables.\n' +
      '✅ TODOS los usuarios y sus credenciales.\n' +
      '✅ TODOS los reportes y configuraciones.\n\n' +
      '⚠️ ESTA ACCIÓN NO SE PUEDE DESHACER.';

    if (!confirm(confirmMsg)) return;

    setIsFormatting(true);
    try {
      // ===== 1. ELIMINAR TODAS LAS COLECCIONES =====
      const colecciones = [
        'productos',
        'ventas',
        'clientes',
        'cxc',
        'cxp',
        'movimientos',
        'terminales',
        'proveedores',
        'devoluciones',
        'anulaciones',
        'libroDiario',
        'reportesZ',
        'catalogos',
        'inventario',
        'config',
        'users'
      ];

      console.log('🗑️ Iniciando eliminación de colecciones...');
      for (const colName of colecciones) {
        console.log(`Eliminando colección "${colName}"...`);
        await deleteCollection(colName);
      }

      // ===== 2. ELIMINAR DOCUMENTOS DE pos_system_data (excepto 'state') =====
      try {
        const mainColRef = collection(db, 'pos_system_data');
        const mainSnapshot = await getDocs(mainColRef);
        const batch = writeBatch(db);
        mainSnapshot.docs.forEach((docSnap) => {
          if (docSnap.id !== 'state') {
            batch.delete(docSnap.ref);
          }
        });
        await batch.commit();
        console.log('✅ Documentos extras en pos_system_data eliminados (excepto state).');
      } catch (e) {
        console.warn('⚠️ Error al limpiar pos_system_data:', e);
      }

      // ===== 3. REINICIAR CONFIGURACIÓN GLOBAL (config/general) =====
      const configRef = doc(db, 'config', 'general');
      await setDoc(configRef, {
        isInitialized: false,
        ultimoZ: 0,
        proximoRecibo: 1,
        proximaDevolucion: 1,
        proximaAnulacion: 1,
        acumuladoHistorico: 0,
        fechaUltimoZ: '',
        fondoCajaHoyUSD: 0,
        fondoCajaHoyBS: 0,
        tasa: state.tasa || 36.50,
        pinDevolucion: '000000',
        empresa: {
          nombre: 'NOMBRE DE SU NEGOCIO',
          rif: 'J-00000000-0',
          direccion: 'DIRECCIÓN FISCAL',
          telefono: '0000-0000000'
        }
      }, { merge: true });
      console.log('✅ Configuración global reiniciada con valores iniciales.');

      // ===== 4. LIMPIAR SESIÓN Y SALIR =====
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('posven_apertura_done');
        localStorage.removeItem('posven_last_cxp_alert');
      }

      toast({ 
        title: "Sistema Formateado", 
        description: "Todos los datos han sido eliminados permanentemente." 
      });

      // ===== 5. CERRAR SESIÓN =====
      try {
        await signOut(auth);
      } catch (e) {
        console.warn('⚠️ Error al cerrar sesión:', e);
      }

      // ===== 6. REDIRIGIR AL LOGIN =====
      window.location.href = '/login';

    } catch (error: any) {
      console.error("❌ Error en formateo:", error);
      toast({ 
        variant: "destructive", 
        title: "Fallo en Limpieza", 
        description: error.message 
      });
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
      {/* ===== TASA DE CAMBIO ===== */}
      <div className="card shadow-lg border-line">
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

      {/* ===== MIGRACIÓN DE DATOS ===== */}
      <div className="card shadow-lg border-blue-500/30 bg-blue-50 border-2">
        <div className="card-head border-b border-blue-500/20 px-5 py-4">
          <h3 className="text-blue-700 font-black uppercase italic text-xs flex items-center gap-2">
            <Database className="w-4 h-4" /> Migración de Estructura de Datos
          </h3>
        </div>
        <div className="card-body p-6 bg-white">
          <p className="text-xs text-ink font-bold mb-4">
            Esta acción migrará los datos de la estructura antigua (documento único) a la nueva estructura (colecciones separadas).
          </p>
          <div className="flex flex-col gap-3">
            <button 
              className="btn bg-blue-600 hover:bg-blue-700 text-white h-12 px-8 font-black uppercase text-xs shadow-xl flex items-center gap-2" 
              onClick={handleMigrar}
              disabled={isMigrating}
            >
              {isMigrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isMigrating ? 'MIGRANDO DATOS...' : 'Migrar Estructura de Datos'}
            </button>

            {showMigracionResultado && migracionResultado && (
              <div className={`mt-4 p-4 rounded-lg border ${migracionResultado.success ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
                <h4 className={`font-black uppercase text-xs mb-2 ${migracionResultado.success ? 'text-green-700' : 'text-red-700'}`}>
                  {migracionResultado.success ? '✅ Migración completada exitosamente' : '❌ Error en migración'}
                </h4>
                {migracionResultado.success && resultados ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between"><span className="font-bold">Config:</span> <span>{resultados.config || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Catálogos:</span> <span>{resultados.catalogos || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Inventario:</span> <span>{resultados.inventario || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Ventas:</span> <span>{resultados.ventas || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Movimientos:</span> <span>{resultados.movimientos || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Terminales:</span> <span>{resultados.terminales || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Proveedores:</span> <span>{resultados.proveedores || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Devoluciones:</span> <span>{resultados.devoluciones || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Anulaciones:</span> <span>{resultados.anulaciones || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CXC:</span> <span>{resultados.cxc || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CXP:</span> <span>{resultados.cxp || 0}</span></div>
                    <div className="flex justify-between"><span className="font-bold">Clientes:</span> <span>{resultados.clientes || 0}</span></div>
                  </div>
                ) : migracionResultado.success ? (
                  <p className="text-xs text-yellow-700">No se encontraron resultados para mostrar</p>
                ) : (
                  <p className="text-xs text-red-700">{migracionResultado.error || 'Error desconocido'}</p>
                )}
                <button 
                  className="mt-3 text-xs font-black underline hover:no-underline"
                  onClick={() => setShowMigracionResultado(false)}
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
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