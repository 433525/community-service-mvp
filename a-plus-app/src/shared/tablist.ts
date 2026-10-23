import type { Directive } from 'vue'

/**
 * v-tablist：为筛选组补全 WAI-ARIA Tabs 的键盘契约。
 * - 只有当前选中项进入 Tab 序列（roving tabindex）；
 * - ←/→ 循环切换，Home/End 跳到首尾，Enter/Space 由原生按钮处理；
 * - 自动激活：焦点移动即触发 click，与既有筛选逻辑保持一致。
 * 只改变键盘行为，不改变 DOM 结构与业务状态。
 */

function tabsOf(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .filter((node) => !node.hasAttribute('disabled'))
}

function syncTabIndex(root: HTMLElement) {
  const tabs = tabsOf(root)
  if (!tabs.length) return
  let active = tabs.findIndex((node) => node.getAttribute('aria-selected') === 'true')
  if (active < 0) active = 0
  tabs.forEach((node, index) => { node.tabIndex = index === active ? 0 : -1 })
}

function onKeydown(event: KeyboardEvent) {
  const root = event.currentTarget as HTMLElement | null
  if (!root) return
  const target = event.target as HTMLElement | null
  if (!target || target.getAttribute('role') !== 'tab') return
  const tabs = tabsOf(root)
  if (tabs.length < 2) return
  const current = tabs.indexOf(target as HTMLButtonElement)
  if (current < 0) return

  let next = -1
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  if (next < 0) return

  event.preventDefault()
  const node = tabs[next]
  node.focus()
  node.click()
  syncTabIndex(root)
}

export const vTablist: Directive<HTMLElement> = {
  mounted(root) {
    root.addEventListener('keydown', onKeydown)
    syncTabIndex(root)
  },
  updated(root) { syncTabIndex(root) },
  unmounted(root) { root.removeEventListener('keydown', onKeydown) },
}
