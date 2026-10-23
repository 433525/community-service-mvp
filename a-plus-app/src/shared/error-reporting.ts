import type { App } from 'vue'

/**
 * 统一异常上报：
 * - 捕获组件渲染/生命周期异常，避免整页白屏；
 * - 通过自定义事件把可读提示交给页面 toast，不暴露堆栈给用户；
 * - 未处理的 Promise 拒绝只记录到控制台，避免打断本机演练流程。
 */
export interface AppErrorDetail {
  message: string
}

export const APP_ERROR_EVENT = 'app:error'

export function installErrorReporting(app: App, scope: 'intake' | 'community') {
  app.config.errorHandler = (error, _instance, info) => {
    console.error(`[${scope}] vue error (${info})`, error)
    window.dispatchEvent(new CustomEvent<AppErrorDetail>(APP_ERROR_EVENT, {
      detail: { message: '界面出现异常，当前本机数据未被修改；如页面无法继续操作，请刷新后重试。' },
    }))
  }

  window.addEventListener('unhandledrejection', (event) => {
    console.error(`[${scope}] unhandled rejection`, event.reason)
  })
}
