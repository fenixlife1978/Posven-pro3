import { getFirestore, doc, getDoc, setDoc, collection, writeBatch } from 'firebase/firestore';
import app from '@/lib/firebase';

export async function migrarEstructura() {
  const db = getFirestore(app);
  const resultados = {
    config: 0,
    catalogos: 0,
    inventario: 0,
    ventas: 0,
    movimientos: 0,
    terminales: 0,
    proveedores: 0,
    devoluciones: 0,
    anulaciones: 0,
    cxc: 0,
    cxp: 0,
    clientes: 0
  };

  try {
    // ===== RUTA CORRECTA: pos_system_data/state =====
    const stateRef = doc(db, 'pos_system_data', 'state');
    const stateDoc = await getDoc(stateRef);
    
    if (!stateDoc.exists()) {
      // Intentar con la ruta alternativa por si acaso
      console.log('⚠️ No encontrado en pos_system_data/state, intentando en data/state...');
      const stateRefAlt = doc(db, 'data', 'state');
      const stateDocAlt = await getDoc(stateRefAlt);
      
      if (!stateDocAlt.exists()) {
        throw new Error('Documento state no encontrado en ninguna ruta. Verifica que Firestore tenga datos.');
      }
      
      // Si existe en la ruta alternativa, usamos esos datos
      const data = stateDocAlt.data();
      console.log('📊 Datos encontrados en data/state:', Object.keys(data).length, 'campos');
      await migrarDatos(db, data, resultados);
      return { success: true, resultados };
    }
    
    const data = stateDoc.data();
    console.log('📊 Datos encontrados en pos_system_data/state:', Object.keys(data).length, 'campos');
    await migrarDatos(db, data, resultados);
    
    console.log('🎉 Migración completada exitosamente');
    console.table(resultados);
    
    return { success: true, resultados };
  } catch (error) {
    console.error('❌ Error en migración:', error);
    return { success: false, error: String(error) };
  }
}

// Función auxiliar para migrar los datos
async function migrarDatos(db: any, data: any, resultados: any) {
  // ===== 1. CONFIGURACIÓN =====
  await setDoc(doc(db, 'config', 'general'), {
    acumuladoHistorico: data.acumuladoHistorico || 0,
    pinDevolucion: data.pinDevolucion || '123456',
    proximaDevolucion: data.proximaDevolucion || 1,
    proximoRecibo: data.proximoRecibo || 1,
    tasa: data.tasa || 0,
    ultimoZ: data.ultimoZ || 0,
    empresa: data.empresa || {},
    fechaUltimoZ: data.fechaUltimoZ || '',
    fondoCajaHoyUSD: data.fondoCajaHoyUSD || 0,
    fondoCajaHoyBS: data.fondoCajaHoyBS || 0
  });
  resultados.config = 1;
  console.log('✅ Config migrada');

  // ===== 2. CATÁLOGOS =====
  const catalogos = [
    { nombre: 'categorias', data: data.categorias || [] },
    { nombre: 'departamentos', data: data.departamentos || [] },
    { nombre: 'marcas', data: data.marcas || [] },
    { nombre: 'presentaciones', data: data.presentaciones || [] },
    { nombre: 'productCategories', data: data.productCategories || [] },
    { nombre: 'productUnits', data: data.productUnits || [] },
    { nombre: 'productColors', data: data.productColors || [] },
    { nombre: 'productSizes', data: data.productSizes || [] },
    { nombre: 'brands', data: data.brands || [] },
    { nombre: 'groups', data: data.groups || [] },
    { nombre: 'subgroups', data: data.subgroups || [] },
    { nombre: 'lines', data: data.lines || [] },
    { nombre: 'suppliers', data: data.suppliers || [] }
  ];

  for (const cat of catalogos) {
    await setDoc(doc(db, 'catalogos', cat.nombre), { lista: cat.data });
  }
  resultados.catalogos = catalogos.length;
  console.log('✅ Catálogos migrados');

  // ===== 3. INVENTARIO (PRODUCTOS) =====
  if (data.productos && Array.isArray(data.productos) && data.productos.length > 0) {
    const batch = writeBatch(db);
    data.productos.forEach((producto: any) => {
      const id = producto.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'inventario', id);
      batch.set(docRef, {
        ...producto,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.inventario = data.productos.length;
    console.log(`✅ ${data.productos.length} productos migrados`);
  }

  // ===== 4. VENTAS =====
  if (data.ventas && Array.isArray(data.ventas) && data.ventas.length > 0) {
    const batch = writeBatch(db);
    data.ventas.forEach((venta: any) => {
      const id = venta.id || `venta_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'ventas', id);
      batch.set(docRef, {
        ...venta,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.ventas = data.ventas.length;
    console.log(`✅ ${data.ventas.length} ventas migradas`);
  }

  // ===== 5. MOVIMIENTOS =====
  if (data.movimientos && Array.isArray(data.movimientos) && data.movimientos.length > 0) {
    const batch = writeBatch(db);
    data.movimientos.forEach((mov: any) => {
      const id = mov.id || `mov_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'movimientos', id);
      batch.set(docRef, {
        ...mov,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.movimientos = data.movimientos.length;
    console.log(`✅ ${data.movimientos.length} movimientos migrados`);
  }

  // ===== 6. TERMINALES =====
  if (data.terminales && Array.isArray(data.terminales) && data.terminales.length > 0) {
    const batch = writeBatch(db);
    data.terminales.forEach((term: any) => {
      const id = term.id || `term_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'terminales', id);
      batch.set(docRef, {
        ...term,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.terminales = data.terminales.length;
    console.log(`✅ ${data.terminales.length} terminales migrados`);
  }

  // ===== 7. PROVEEDORES =====
  if (data.proveedores && Array.isArray(data.proveedores) && data.proveedores.length > 0) {
    const batch = writeBatch(db);
    data.proveedores.forEach((prov: any) => {
      const id = prov.id || `prov_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'proveedores', id);
      batch.set(docRef, {
        ...prov,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.proveedores = data.proveedores.length;
    console.log(`✅ ${data.proveedores.length} proveedores migrados`);
  }

  // ===== 8. DEVOLUCIONES =====
  if (data.devoluciones && Array.isArray(data.devoluciones) && data.devoluciones.length > 0) {
    const batch = writeBatch(db);
    data.devoluciones.forEach((dev: any) => {
      const id = dev.id || `dev_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'devoluciones', id);
      batch.set(docRef, {
        ...dev,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.devoluciones = data.devoluciones.length;
    console.log(`✅ ${data.devoluciones.length} devoluciones migradas`);
  }

  // ===== 9. ANULACIONES =====
  if (data.anulaciones && Array.isArray(data.anulaciones) && data.anulaciones.length > 0) {
    const batch = writeBatch(db);
    data.anulaciones.forEach((anu: any) => {
      const id = anu.id || `anu_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'anulaciones', id);
      batch.set(docRef, {
        ...anu,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.anulaciones = data.anulaciones.length;
    console.log(`✅ ${data.anulaciones.length} anulaciones migradas`);
  }

  // ===== 10. CXC (CUENTAS POR COBRAR) =====
  if (data.cxc && Array.isArray(data.cxc) && data.cxc.length > 0) {
    const batch = writeBatch(db);
    data.cxc.forEach((cxcItem: any) => {
      const id = cxcItem.id || `cxc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'cxc', id);
      batch.set(docRef, {
        ...cxcItem,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.cxc = data.cxc.length;
    console.log(`✅ ${data.cxc.length} CXC migrados`);
  }

  // ===== 11. CXP (CUENTAS POR PAGAR) =====
  if (data.cxp && Array.isArray(data.cxp) && data.cxp.length > 0) {
    const batch = writeBatch(db);
    data.cxp.forEach((cxpItem: any) => {
      const id = cxpItem.id || `cxp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'cxp', id);
      batch.set(docRef, {
        ...cxpItem,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.cxp = data.cxp.length;
    console.log(`✅ ${data.cxp.length} CXP migrados`);
  }

  // ===== 12. CLIENTES =====
  if (data.clientes && Array.isArray(data.clientes) && data.clientes.length > 0) {
    const batch = writeBatch(db);
    data.clientes.forEach((cliente: any) => {
      const id = cliente.id || `cliente_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const docRef = doc(db, 'clientes', id);
      batch.set(docRef, {
        ...cliente,
        _migrado: true,
        _fechaMigracion: new Date().toISOString()
      });
    });
    await batch.commit();
    resultados.clientes = data.clientes.length;
    console.log(`✅ ${data.clientes.length} clientes migrados`);
  }

  // ===== GUARDAR RESULTADO DE MIGRACIÓN =====
  // ===== CORREGIDO: Sumar valores numéricos correctamente =====
  const totalMigrado = 
    resultados.config +
    resultados.catalogos +
    resultados.inventario +
    resultados.ventas +
    resultados.movimientos +
    resultados.terminales +
    resultados.proveedores +
    resultados.devoluciones +
    resultados.anulaciones +
    resultados.cxc +
    resultados.cxp +
    resultados.clientes;

  await setDoc(doc(db, 'config', 'migracion'), {
    fecha: new Date().toISOString(),
    resultados: resultados,
    totalMigrado: totalMigrado
  });

  console.log('🎉 Migración completada exitosamente');
  console.table(resultados);
}

// Función para verificar el estado de la migración
export async function verificarMigracion() {
  const db = getFirestore(app);
  try {
    const docRef = doc(db, 'config', 'migracion');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return {
        migrado: true,
        data: docSnap.data()
      };
    }
    return { migrado: false };
  } catch (error) {
    return { migrado: false, error: String(error) };
  }
}