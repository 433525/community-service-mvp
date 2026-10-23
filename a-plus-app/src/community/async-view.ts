import { defineAsyncComponent, type Component } from 'vue'
import { loadWithRetry } from '../shared/chunk-recovery'
import ViewLoading from './components/ViewLoading.vue'
import ViewError from './components/ViewError.vue'

/**
 * 页签级代码分割：首屏只加载首页与社区，其余页签在首次进入时按需加载。
 * - delay 120ms：本地加载很快时不闪 loading；
 * - 失败重试 1 次（400ms 后）：覆盖弱网瞬断，重试仍失败才进入错误态；
 * - errorComponent：分块加载失败时给出可恢复提示，不白屏；
 * - timeout 12s：弱设备/磁盘忙时仍有兜底。
 */
export function asyncView(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader: () => loadWithRetry(loader, { retries: 1, delayMs: 400 }),
    loadingComponent: ViewLoading,
    errorComponent: ViewError,
    delay: 120,
    timeout: 12000,
  })
}
