import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxy = {
  '/bp': {
    target: process.env.VITE_API_PROXY_TARGET || 'http://backend:5000',
    changeOrigin: true,
    timeout: 60 * 60 * 1000,
    proxyTimeout: 60 * 60 * 1000,
  },
}

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['zickzack-cloud.duckdns.org'],
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['zickzack-cloud.duckdns.org'],
    proxy,
  },
})
