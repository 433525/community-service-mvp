<script setup lang="ts">
import { useAplusContext } from '../context'

const { store, toggleIntakePaused } = useAplusContext()
</script>

<template>
  <section class="intake-gate" :class="{ paused: store.intakePaused }" aria-label="本机合成演练受理开关">
    <div class="intake-gate-mark" aria-hidden="true">{{ store.intakePaused ? 'Ⅱ' : '▶' }}</div>
    <div class="intake-gate-copy">
      <strong role="status" aria-live="polite">{{ store.intakePaused ? '新登记已暂停 · 仅限本机合成演练' : '新登记开放 · 仅限本机合成演练' }}</strong>
      <p>{{ store.intakePaused ? '手动新建演练记录和社区桥登记已停止；已有记录仍可继续跟进。' : '可手动新建演练记录，或从社区桥登记合成求助。' }} 此开关只影响当前浏览器的演练数据，不是生产受理权限，也不代表真实服务已停开、停服或已通知任何人。</p>
    </div>
    <button class="button" :class="store.intakePaused ? 'primary' : 'danger'" type="button" :aria-pressed="store.intakePaused" @click="toggleIntakePaused">{{ store.intakePaused ? '恢复新登记' : '暂停新登记' }}</button>
  </section>
</template>
