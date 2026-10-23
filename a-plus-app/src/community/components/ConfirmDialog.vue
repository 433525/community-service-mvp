<script setup lang="ts">
/**
 * 轻量确认弹层：替代 Vant Dialog，保持与社区端一致的视觉与键盘行为。
 * - Esc / 点击遮罩 = 取消；Tab 在弹层内循环；关闭后焦点归还触发元素。
 * - 打开时锁定背景滚动，并对背景应用 inert（不支持时降级为 aria-hidden）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'default' | 'danger'
}>(), {
  confirmText: '确认',
  cancelText: '取消',
  tone: 'default',
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialogRef = ref<HTMLElement | null>(null)
const confirmRef = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null
let previousOverflow = ''

function focusable(): HTMLElement[] {
  const root = dialogRef.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((node) => !node.hasAttribute('disabled'))
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return
  const nodes = focusable()
  if (!nodes.length) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    confirmRef.value?.focus()
  } else {
    document.body.style.overflow = previousOverflow
    const target = returnFocus
    returnFocus = null
    await nextTick()
    target?.focus?.()
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = previousOverflow
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="confirm-backdrop" @click.self="emit('cancel')" @keydown="onKeydown">
      <section
        ref="dialogRef"
        class="confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <h2 id="confirm-title">{{ title }}</h2>
        <p id="confirm-message">{{ message }}</p>
        <div class="confirm-actions">
          <button class="button-ghost" type="button" @click="emit('cancel')">{{ cancelText }}</button>
          <button
            ref="confirmRef"
            :class="tone === 'danger' ? 'confirm-danger' : 'button-primary'"
            type="button"
            @click="emit('confirm')"
          >{{ confirmText }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed; z-index: 60; inset: 0;
  display: grid; place-items: center; padding: 20px;
  background: rgb(16 31 24 / 48%);
  animation: fade-in .16s ease-out;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.confirm-card {
  width: min(440px, 100%); padding: 24px;
  border-radius: var(--r-xl); background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.confirm-card h2 { color: var(--ink-strong); font-size: var(--fs-lg); line-height: 1.35; }
.confirm-card p { margin-top: 9px; color: var(--body); font-size: var(--fs-sm); line-height: 1.75; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; }
.confirm-actions button { min-height: 44px; padding: 0 18px; border-radius: var(--r-sm); font-size: var(--fs-sm); font-weight: 700; }
.confirm-danger { border: 1px solid #9c3f34; color: #fff; background: #9c3f34; }
.confirm-danger:hover { background: #83342b; }
@media (max-width: 720px) {
  .confirm-backdrop { align-items: end; padding: 0; }
  .confirm-card { width: 100%; border-radius: 18px 18px 0 0; padding: 22px 18px max(18px, env(safe-area-inset-bottom)); }
  .confirm-actions button { flex: 1; }
}
</style>
