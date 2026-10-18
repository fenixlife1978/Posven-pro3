
import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        brand: {
          gold: '#C8952E',
          'gold-soft': '#F5E9CC',
          'gold-deep': '#A37619',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          warm: '#E6E1D3',
          soft: '#EFEBE0',
        },
        ink: {
          DEFAULT: '#141414',
          muted: '#141414',
          subtle: '#141414',
        },
        line: {
          DEFAULT: '#D9D2BF',
          strong: '#BDB6A4',
        },
        status: {
          success: '#2F8F3F',
          'success-soft': 'rgba(47, 143, 63, 0.1)',
          danger: '#C0392B',
          'danger-soft': 'rgba(192, 57, 43, 0.1)',
          info: '#2563EB',
          'info-soft': 'rgba(37, 99, 235, 0.1)',
          warn: '#A37619',
          'warn-soft': 'rgba(163, 118, 25, 0.1)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '24px',
      },
      boxShadow: {
        'sm-card': '0 1px 2px rgba(20,20,20,.04)',
        card: '0 4px 12px rgba(20,20,20,.05)',
        pop: '0 8px 32px rgba(20,20,20,.08)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
