// 让 `node --experimental-strip-types` 能加载 src/ 里的真实 TS 源码。
//
// 为什么需要这个钩子：Node 的 ESM 解析器不会补扩展名，而 src/domain/*.ts 之间
// 用的是无扩展名相对导入（`import ... from './intake'`），Vite/tsc 能解析，
// 裸 Node 不能（ERR_MODULE_NOT_FOUND）。这里只补“文件确实存在”的情况，
// 找不到时仍交回默认解析，避免掩盖真正的导入错误。
//
// 仅用于测试进程（通过 `node --import ./tools/unit/ts-extension-hook.mjs` 注册），
// 不参与应用构建与运行时。
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HAS_KNOWN_EXTENSION = /\.(?:[cm]?[jt]sx?|json|css)$/

const CANDIDATE_SUFFIXES = ['.ts', '.mts', '.tsx', '/index.ts']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    if (isRelative && context.parentURL && !HAS_KNOWN_EXTENSION.test(specifier)) {
      for (const suffix of CANDIDATE_SUFFIXES) {
        const url = new URL(specifier + suffix, context.parentURL)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})
