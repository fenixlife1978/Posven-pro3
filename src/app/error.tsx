'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      localStorage.setItem('posven_last_error', JSON.stringify({ message: error?.message, stack: error?.stack, time: new Date().toISOString() }));
    } catch (e) {}
  }, [error]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#F5F1E8', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 640, width: '100%', background: '#fff', borderRadius: 24, padding: 32, boxShadow: '0 20px 50px rgba(0,0,0,0.1)', border: '1px solid #E5DFD2' }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#C8952E', textTransform: 'uppercase', letterSpacing: 1 }}>PosVEN Pro · Error inesperado</h1>
        <p style={{ fontSize: 13, color: '#1C1B18', marginTop: 12, fontWeight: 700 }}>Se produjo una excepción al cargar la aplicación.</p>
        <pre style={{ background: '#F5F1E8', padding: 16, borderRadius: 12, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 16, color: '#B3261E' }}>
          {error?.message || 'Sin mensaje de error'}
        </pre>
        {error?.stack && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#1C1B18', cursor: 'pointer' }}>Ver detalle técnico</summary>
            <pre style={{ background: '#F5F1E8', padding: 16, borderRadius: 12, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 8, color: '#1C1B18' }}>
              {error.stack}
            </pre>
          </details>
        )}
        <button
          onClick={() => reset()}
          style={{ marginTop: 20, background: '#C8952E', color: '#1C1B18', fontWeight: 800, border: 'none', padding: '12px 24px', borderRadius: 12, cursor: 'pointer', fontSize: 12, textTransform: 'uppercase' }}
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
