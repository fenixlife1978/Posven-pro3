"use client";

import { useEffect, useRef } from 'react';
import { toast } from '@/hooks/use-toast';

export function useBarcodeScanner(onScan: (barcode: string) => void) {
  const buffer = useRef<string>('');
  const lastKeyTime = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeDiff = now - lastKeyTime.current;
      lastKeyTime.current = now;

      // HID scanners type very fast. Human typists are slower.
      // 30ms is a safe threshold for rapid scanning sequences.
      if (timeDiff > 50) {
        buffer.current = '';
      }

      if (e.key === 'Enter') {
        if (buffer.current.length > 2) {
          const code = buffer.current;
          buffer.current = '';
          onScan(code);
          e.preventDefault();
        }
      } else if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScan]);

  // Visual indication when a scanner is likely connected
  useEffect(() => {
    // This is a simple mock, real HID detection is complex in web,
    // but the system will listen to rapid key events regardless.
  }, []);
}
