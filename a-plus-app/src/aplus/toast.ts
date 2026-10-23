/**
 * 单条全局提示（toast）。
 *
 * 不引入第三方组件库的原因：A+ 端只需要一条可被读屏播报的短提示，
 * 且错误等级决定 role/aria-live（alert + assertive / status + polite），
 * 由文案特征推断等级，避免每个调用点重复传参。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

const ERROR_HINT = /失败|错误|请先|请填写|不能|无效|已达|上限|无法|未保存|已停止|不可用|拒绝/

export function useToast(durationMs = 2600) {
  const toastMessage = ref('')
  const toastIsError = computed(() => ERROR_HINT.test(toastMessage.value))
  let timer: number | undefined

  function notify(message: string) {
    toastMessage.value = message
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      // 期间若已有新提示，不要被旧定时器清空。
      if (toastMessage.value === message) toastMessage.value = ''
      timer = undefined
    }, durationMs)
  }

  function dismissToast() {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    toastMessage.value = ''
  }

  onBeforeUnmount(dismissToast)

  return { toastMessage, toastIsError, notify, dismissToast }
}
