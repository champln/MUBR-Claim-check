import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: บนเครื่องนี้ 8000 = ระบบตรวจสุขภาพ (prod), 8001 = ระบบตรวจสุขภาพ (test) — MUBR ใช้ 8090
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8090'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,              // ผูก 0.0.0.0 -> เครื่องอื่นใน intranet เข้าถึงได้
    allowedHosts: true,      // อนุญาตให้เข้าผ่าน IP/hostname ใดก็ได้ (สำหรับทดสอบใน LAN)
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
