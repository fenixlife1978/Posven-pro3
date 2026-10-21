import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: 'PosVEN pro - Soluciones Profesionales',
  description: 'Sistema de Punto de Venta avanzado para comercios en Venezuela, con gestión de inventario, ventas a crédito y reportes profesionales detallados.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={process.env.POSVEN_DEMO_MODE === '1' ? 'antialiased min-h-screen bg-background text-foreground pt-12' : 'antialiased min-h-screen bg-background text-foreground'}>
        {process.env.POSVEN_DEMO_MODE === '1' ? (
          <div role="status" className="fixed inset-x-0 top-0 z-[9999] border-b-2 border-amber-400 bg-slate-950 px-3 py-2 text-center text-xs font-semibold tracking-wide text-white shadow-lg sm:text-sm">
            POSVEN PRO · DEMO — Versión de demostración con límite de 10 acciones por módulo. Adquiere la versión completa para uso sin límites.
          </div>
        ) : null}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
