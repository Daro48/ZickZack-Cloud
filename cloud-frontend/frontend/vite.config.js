export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['zickzack-cloud.duckdns.org'],
    // oder: allowedHosts: true,
    proxy: {
      '/bp': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://backend:5000',
        changeOrigin: true,
        timeout: 60 * 60 * 1000,
        proxyTimeout: 60 * 60 * 1000,
      },
    },
  },
})