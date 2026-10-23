/**
 * clipboard.ts — 复制文本的统一入口。
 *
 * 优先使用异步 Clipboard API（需要安全上下文）；在 http:// 局域网地址、
 * 旧版浏览器或权限被拒绝时退回 `document.execCommand('copy')`。
 * 降级路径会临时插入只读文本域，复制后移除并把焦点还给原控件。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  const secure = typeof window === 'undefined' || window.isSecureContext !== false
  if (clipboard && typeof clipboard.writeText === 'function' && secure) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // 权限拒绝或页面失焦：继续尝试同步降级方案。
    }
  }
  return copyWithTextarea(text)
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')
  field.setAttribute('tabindex', '-1')
  field.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;padding:0;border:0;opacity:0;'
  document.body.appendChild(field)
  try {
    field.select()
    field.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    previous?.focus({ preventScroll: true })
  }
}
