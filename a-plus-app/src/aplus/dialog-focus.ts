/**
 * 模态对话框的焦点管理（WAI-ARIA APG「Dialog (Modal)」模式的最小实现）。
 *
 * 职责边界：
 * 1. 打开时把焦点移入对话框：优先 `[data-autofocus]`，其次首个可编辑字段，最后首个可聚焦元素；
 * 2. 打开期间把 Tab / Shift+Tab 的循环限制在对话框内；
 * 3. Esc 交给调用方关闭（是否允许关闭由业务决定）；
 * 4. 关闭后把焦点还给触发元素，元素已移除时退化为可见区域内的合理落点。
 *
 * 说明：这里按 APG 的“模态”语义只处理键盘焦点，背景的 inert 由模板绑定
 * `:inert` 完成；不使用 `aria-hidden`，避免与 inert 双重隐藏导致读屏重复播报。
 */
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

/** 与既有 DOM 约定保持一致：.modal 与 .dialog-card 都是对话框容器。 */
const DIALOG_ROOT_SELECTOR = '.modal-backdrop .modal, .modal-backdrop .dialog-card'

/**
 * 可 Tab 聚焦的候选。排除隐藏输入、负 tabindex、禁用与不可见节点，
 * 与 tabbable 的判定口径一致但不引入依赖。
 */
const FOCUSABLE_SELECTOR = [
  'button',
  '[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface DialogFocusOptions {
  /** 当前是否有对话框打开。 */
  isOpen: () => boolean
  /** Esc 按下时的关闭动作。 */
  onEscape: () => void
}

export function useDialogFocus({ isOpen, onEscape }: DialogFocusOptions) {
  let returnFocus: HTMLElement | null = null

  function dialogRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>(DIALOG_ROOT_SELECTOR)
  }

  function focusables(): HTMLElement[] {
    const root = dialogRoot()
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((node) => {
      if (node.hasAttribute('disabled') || node.getAttribute('aria-hidden') === 'true') return false
      if (node.closest('[inert]')) return false
      // getClientRects 为空说明节点或祖先不可见（display:none / 未挂载）。
      if (!node.getClientRects().length) return false
      return getComputedStyle(node).visibility !== 'hidden'
    })
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (!isOpen()) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return

    const candidates = focusables()
    if (!candidates.length) return
    const first = candidates[0]
    const last = candidates[candidates.length - 1]
    const active = document.activeElement as HTMLElement | null

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    } else if (!active || !candidates.includes(active)) {
      // 焦点被脚本或浏览器移出对话框时拉回，避免键盘用户“掉”到背景页面。
      event.preventDefault()
      first.focus()
    }
  }

  watch(isOpen, async (open, wasOpen) => {
    if (open && !wasOpen) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      const root = dialogRoot()
      const preferred = root?.querySelector<HTMLElement>('[data-autofocus]')
      const field = root?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([readonly]), textarea:not([readonly]), select',
      )
      ;(preferred ?? field ?? focusables()[0])?.focus()
      return
    }
    if (!open && wasOpen) {
      const target = returnFocus
      returnFocus = null
      await nextTick()
      // 触发元素可能随列表重渲染消失；此时保持浏览器默认焦点，不做强制跳转。
      target?.focus?.()
    }
  })

  onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

  return { focusables }
}
