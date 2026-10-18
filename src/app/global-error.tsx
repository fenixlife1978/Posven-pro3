'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#F5F1E8', fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 640, width: '100%', background: '#fff', borderRadius: 24, padding: 32, boxShadow: '0 20px 50px rgba(0,0,0,0.1)', border: '1px solid #E5DFD2' }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#C8952E', textTransform: 'uppercase', letterSpacing: 1 }}>PosVEN Pro · Error crítico</h1>
          <pre style={{ background: '#F5F1E8', padding: 16, borderRadius: 12, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 16, color: '#B3261E' }}>
            {error?.message || 'Error sin mensaje'}
          </pre>
          <button
            onClick={() => reset()}
            style={{ marginTop: 20, background: '#C8952E', color: '#1C1B18', fontWeight: 800, border: 'none', padding: '12px 24px', borderRadius: 12, cursor: 'pointer', fontSize: 12, textTransform: 'uppercase' }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
