<script setup lang="ts">
import { useAplusContext } from '../context'

const { store, activeFilter } = useAplusContext()
</script>

<template>
  <section class="metric-grid" aria-label="演练统计">
    <button type="button" class="metric-card" :class="{ selected: activeFilter === '待分诊' }" :aria-pressed="activeFilter === '待分诊'" @click="activeFilter = '待分诊'">
      <div class="metric-label">待分诊记录</div>
      <div class="metric-value">{{ store.triageCases.length }}<small>条</small></div>
      <div class="metric-foot">收件或初筛后待分流 · 点击筛选</div>
    </button>
    <button type="button" class="metric-card" :class="{ selected: activeFilter === '初筛中' }" :aria-pressed="activeFilter === '初筛中'" @click="activeFilter = '初筛中'">
      <div class="metric-label">常规初筛中</div>
      <div class="metric-value">{{ store.screeningCases.length }}<small>条</small></div>
      <div class="metric-foot">高风险记录停止普通初筛 · 点击筛选</div>
    </button>
    <button type="button" class="metric-card" :class="{ alert: store.overdueCases.length > 0, selected: activeFilter === '演练逾期' }" :aria-pressed="activeFilter === '演练逾期'" @click="activeFilter = '演练逾期'">
      <div class="metric-label">逾期演练待办</div>
      <div class="metric-value">{{ store.overdueCases.length }}<small>条</small></div>
      <div class="metric-foot">仅提醒人工跟进，不自动外联 · 点击筛选</div>
    </button>
    <button type="button" class="metric-card" :class="{ alert: store.highRiskCases.length > 0, selected: activeFilter === '高风险' }" :aria-pressed="activeFilter === '高风险'" @click="activeFilter = '高风险'">
      <div class="metric-label">高风险停止标记</div>
      <div class="metric-value">{{ store.highRiskCases.length }}<small>条</small></div>
      <div class="metric-foot">按机构已批准的外部流程人工处理 · 点击筛选</div>
    </button>
  </section>
</template>
