import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        intake: fileURLToPath(new URL('./index.html', import.meta.url)),
        community: fileURLToPath(new URL('./community.html', import.meta.url)),
      },
    },
  },
})
