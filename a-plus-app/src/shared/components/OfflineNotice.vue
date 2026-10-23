<script setup lang="ts">
/**
 * 非阻断的离线 / 更新提示条（两个入口共用）。
 *
 * - 只在「断网」或「有新版本等待接管」时出现，正常加载不占位、不产生布局位移；
 * - 用 `role="status"` 播报文案，按钮不抢焦点，键盘可 Tab 到；
 * - 离线时不给「更新」按钮：这时点更新也拉不到新资源。
 */
import { computed, ref } from 'vue'
import { offlineNoticeText } from '../offline-policy'
import { useOfflineNotice } from '../offline'

const { kind, updating, applyUpdate, dismissUpdate, dismissOffline } = useOfflineNotice()

const text = computed(() => offlineNoticeText(kind.value))
const isUpdate = computed(() => kind.value === 'update')
const localBusy = ref(false)

const actionLabel = computed(() => (updating.value || localBusy.value ? '正在更新…' : '立即更新'))

function onUpdate() {
  if (localBusy.value) return
  localBusy.value = true
  applyUpdate()
}

function onDismiss() {
  if (isUpdate.value) dismissUpdate()
  else dismissOffline()
}
</script>

<template>
  <div v-if="kind !== 'none'" class="offline-notice" :class="`is-${kind}`">
    <span class="offline-notice__dot" aria-hidden="true"></span>
    <p class="offline-notice__text" role="status">{{ text }}</p>
    <div class="offline-notice__actions">
      <button v-if="isUpdate" class="offline-notice__primary" type="button" :disabled="updating || localBusy" @click="onUpdate">
        {{ actionLabel }}
      </button>
      <button class="offline-notice__ghost" type="button" @click="onDismiss">
        {{ isUpdate ? '稍后' : '知道了' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.offline-notice {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 55;
  display: flex;
  max-width: min(92vw, 480px);
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--offline-border, #2b5b52);
  border-radius: 14px;
  color: #fff;
  background: var(--offline-bg, #143c3a);
  box-shadow: 0 12px 30px rgb(12 32 26 / 26%);
  animation: notice-in 0.18s ease-out;
}

@keyframes notice-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.offline-notice__dot {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 999px;
  background: #e8c46a;
}

.offline-notice.is-offline .offline-notice__dot {
  background: #f0b370;
  box-shadow: 0 0 0 4px rgb(240 179 112 / 22%);
}

.offline-notice__text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: #f4faf6;
  font-size: 13px;
  line-height: 1.5;
}

.offline-notice__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.offline-notice button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.offline-notice__primary {
  border: 1px solid #f4faf6;
  color: #143c3a;
  background: #f4faf6;
}

.offline-notice__primary:hover:not(:disabled) {
  background: #fff;
}

.offline-notice__primary:disabled {
  cursor: progress;
  opacity: 0.72;
}

.offline-notice__ghost {
  border: 1px solid rgb(244 250 246 / 42%);
  color: #f4faf6;
  background: transparent;
}

.offline-notice__ghost:hover {
  background: rgb(244 250 246 / 12%);
}

.offline-notice button:focus-visible {
  outline: 2px solid #f4faf6;
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .offline-notice {
    right: 12px;
    bottom: 84px;
    left: 12px;
    max-width: none;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 12px;
  }

  .offline-notice__text {
    font-size: 12.5px;
    line-height: 1.45;
  }

  .offline-notice__actions {
    margin-left: auto;
  }

  .offline-notice button {
    padding: 0 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .offline-notice {
    animation: none;
  }
}

@media (forced-colors: active) {
  .offline-notice {
    border: 1px solid CanvasText;
    color: CanvasText;
    background: Canvas;
  }

  .offline-notice__dot {
    border: 1px solid CanvasText;
    background: CanvasText;
  }

  .offline-notice button {
    border: 1px solid ButtonText;
    color: ButtonText;
    background: ButtonFace;
  }

  .offline-notice__text {
    color: CanvasText;
  }
}

@media print {
  .offline-notice {
    display: none;
  }
}
</style>
