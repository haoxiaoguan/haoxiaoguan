import daisyui from 'daisyui';
import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/renderer/index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        bento: '0 8px 30px -10px hsl(var(--shadow-bento-color))',
        'bento-light': '0 2px 16px -4px hsl(var(--shadow-bento-light-color))',
        'bento-inner': 'inset 0 1px 0 hsl(var(--shadow-bento-inner-color))',
      },
      backgroundImage: {
        'glass-gradient':
          'linear-gradient(135deg, hsl(var(--shadow-bento-inner-color)) 0%, transparent 100%)',
        'gradient-radial':
          'radial-gradient(ellipse at 30% 40%, var(--tw-gradient-from) 0%, var(--tw-gradient-via) 35%, var(--tw-gradient-to) 70%)',
        'gradient-brand':
          'linear-gradient(180deg, hsl(var(--brand-from)) 0%, hsl(var(--brand-to)) 100%)',
      },
      fontFamily: {
        sans: [
          'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI',
          'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif',
          'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji',
        ],
        mono: [
          'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas',
          'Liberation Mono', 'Courier New', 'monospace',
        ],
      },
      keyframes: {
        rainbow: {
          '0%': { backgroundPosition: '0%' },
          '100%': { backgroundPosition: '200%' },
        },
        shine: {
          '0%': { backgroundPosition: '0% 0%' },
          '50%': { backgroundPosition: '100% 100%' },
          '100%': { backgroundPosition: '0% 0%' },
        },
        gradient: {
          to: { backgroundPosition: 'var(--bg-size, 300%) 0' },
        },
      },
      animation: {
        rainbow: 'rainbow 2s linear infinite',
        gradient: 'gradient 8s linear infinite',
        shine: 'shine 8s ease infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate, daisyui],
  daisyui: {
    themes: ['light', 'dark'],
  },
};
