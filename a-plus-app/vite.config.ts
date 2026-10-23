import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const OUT_DIR = fileURLToPath(new URL('./dist', import.meta.url))

/** 两个入口的 HTML 与其引用的资源一起预缓存，离线时可打开任一端。 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-sw',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const swPath = join(OUT_DIR, 'sw.js')
      const source = await readFile(swPath, 'utf8')
      const assets = (await readdir(join(OUT_DIR, 'assets'))).sort()
      const htmlFiles = ['index.html', 'community.html']
      const pages = await Promise.all(htmlFiles.map((name) => readFile(join(OUT_DIR, name), 'utf8')))
      const precache = ['/index.html', '/community.html', '/favicon.svg', ...assets.map((name) => `/assets/${name}`)]

      // 版本号取「HTML + 资源文件名」的摘要：内容不变则不提示更新；
      // 任一资源或页面文案变化都会让新 SW 进入 waiting。
      const buildId = createHash('sha256').update([...pages, ...assets].join('\n')).digest('hex').slice(0, 12)

      await writeFile(
        swPath,
        source
          .replace("'__SW_BUILD_ID__'", `'${buildId}'`)
          .replace('__SW_PRECACHE__', JSON.stringify(precache, null, 2)),
        'utf8',
      )
      console.log(`[offline-sw] build ${buildId} · ${precache.length} 个预缓存资源`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), offlineServiceWorker()],
  build: {
    rollupOptions: {
      input: {
        intake: fileURLToPath(new URL('./index.html', import.meta.url)),
        community: fileURLToPath(new URL('./community.html', import.meta.url)),
      },
    },
  },
})
