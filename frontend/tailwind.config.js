/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        mubr: {
          blue: '#1a56db',
          teal: '#0694a2',
          light: '#e1effe',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans Thai', 'Sarabun', 'sans-serif'],
      },
      // ขยายขนาดตัวอักษรทั้งระบบราว 12% จากค่าเริ่มต้นของ Tailwind
      // และเพิ่มระยะบรรทัด เพราะภาษาไทยมีสระบน/ล่างและวรรณยุกต์ ต้องการที่หายใจมากกว่าอังกฤษ
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],   // 13px (เดิม 12)
        sm: ['0.9375rem', { lineHeight: '1.5rem' }],    // 15px (เดิม 14)
        base: ['1.0625rem', { lineHeight: '1.75rem' }], // 17px (เดิม 16)
        lg: ['1.1875rem', { lineHeight: '1.875rem' }],  // 19px (เดิม 18)
        xl: ['1.3125rem', { lineHeight: '2rem' }],      // 21px (เดิม 20)
        '2xl': ['1.5625rem', { lineHeight: '2.25rem' }],// 25px (เดิม 24)
        '3xl': ['1.875rem', { lineHeight: '2.5rem' }],  // 30px (เดิม 30)
      },
    },
  },
  plugins: [],
}
