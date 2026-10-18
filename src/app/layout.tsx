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
      <body className="antialiased min-h-screen bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
