/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      boxShadow: {
        panel: '0 20px 45px rgba(15, 23, 42, 0.08)',
        soft: '0 12px 30px rgba(15, 23, 42, 0.05)'
      },
      colors: {
        shell: {
          50: '#f5f7fb',
          100: '#edf1f7',
          200: '#dfe6ef',
          700: '#42526b',
          900: '#18212f'
        },
        brand: {
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#163ea9'
        },
        success: '#0f9f6e',
        warning: '#d97706',
        danger: '#dc2626'
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        display: ['"Sora"', 'sans-serif']
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(24,33,47,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(24,33,47,0.04) 1px, transparent 1px)'
      },
      animation: {
        rise: 'rise 480ms ease forwards'
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
};
