<script setup lang="ts">
import { useAplusContext } from '../context'

const { store, jumpToComplaints, openCommunityBridge, openCreate } = useAplusContext()
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">A+ · INTERNAL INTAKE</div>
      <h1>受控登记队列</h1>
      <p class="page-subtitle">登记、分诊与人工跟进演练。服务类型暂记为「待判定 / 未分类」。</p>
    </div>
    <div class="heading-actions">
      <button class="button" type="button" :aria-label="`跳转到投诉复核队列，${store.pendingComplaints.length} 条待复核`" @click="jumpToComplaints">投诉复核 <span class="action-count">{{ store.pendingComplaints.length }}</span></button>
      <button class="button" type="button" @click="openCommunityBridge">社区求助（本机演练）</button>
      <button class="button primary" type="button" :disabled="store.intakePaused" :title="store.intakePaused ? '本机合成演练已暂停新登记' : ''" @click="openCreate"><span>＋</span> 新建演练记录</button>
    </div>
  </section>
</template>
