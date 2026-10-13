import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/city-api': {
        target: 'https://api.lvxiaolue.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/city-api/, '/api/common/city'),
      },
    },
  }
})
