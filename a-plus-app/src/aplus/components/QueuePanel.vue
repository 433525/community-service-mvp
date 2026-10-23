<script setup lang="ts">
import { getSyntheticSourceChannelLabel, isCaseCheckpointReady, isOpenIntakeStatus } from '../../domain/intake'
import { useAplusContext } from '../context'

const {
  store,
  search,
  filters,
  activeFilter,
  filteredCases,
  selectCase,
  resetQueueFilters,
  caseHasHighRisk,
  isCaseOverdue,
  formatDate,
} = useAplusContext()
</script>

<template>
  <section class="panel queue-panel" aria-label="登记记录列表">
    <div class="queue-sticky">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">登记队列 <small role="status" aria-live="polite">{{ filteredCases.length }} 条演练记录</small></h2>
        <p class="panel-subtitle">只用于演练内部收件和跟进路径</p>
      </div>
      <label class="search-wrap">
        <span class="search-icon">⌕</span>
        <input v-model="search" type="search" aria-label="搜索演练记录" placeholder="搜索演练内容" />
      </label>
    </div>
    <div class="filters" v-tablist role="tablist" aria-label="筛选记录">
      <button v-for="filter in filters" :key="filter" class="filter" :class="{ active: activeFilter === filter }" type="button" role="tab" :aria-selected="activeFilter === filter" @click="activeFilter = filter">{{ filter }}</button>
    </div>
    </div>
    <div v-if="filteredCases.length" class="queue-list">
      <button v-for="item in filteredCases" :key="item.id" class="queue-item" :class="{ selected: store.selectedId === item.id }" :aria-current="store.selectedId === item.id ? 'true' : undefined" type="button" @click="selectCase(item.id)">
        <span class="queue-marker" :class="{ risk: caseHasHighRisk(item), warning: isCaseOverdue(item) }"></span>
        <span class="queue-body">
          <span class="queue-top"><span class="queue-id">{{ item.label }} <small>· {{ item.id }}</small></span><span class="queue-time">{{ formatDate(item.updatedAt) }}</span></span>
          <span class="queue-summary">{{ item.summary }}</span>
          <span class="queue-meta">
            <span class="tag" :class="caseHasHighRisk(item) ? 'risk' : (isCaseOverdue(item) ? 'warning' : 'status')">{{ caseHasHighRisk(item) ? '停止初筛' : item.status }}</span>
            <span class="tag">{{ item.serviceType }}</span>
            <span class="tag">来源：{{ getSyntheticSourceChannelLabel(item.sourceChannel) }}</span>
            <span v-if="isOpenIntakeStatus(item.status) && !isCaseCheckpointReady(item)" class="tag warning">登记检查点未完成</span>
            <span v-if="isCaseOverdue(item) && !caseHasHighRisk(item)" class="tag warning">演练已逾期</span>
            <span class="queue-owner"><span class="mini-avatar">{{ item.owner?.slice(-1) || '—' }}</span>{{ item.owner || '未指派' }}</span>
          </span>
        </span>
      </button>
    </div>
    <div v-else class="empty-state">
      <p>没有匹配的演练记录。<br />更换筛选条件或新建合成案例。</p>
      <button class="button" type="button" @click="resetQueueFilters">清除筛选</button>
    </div>
  </section>
</template>
