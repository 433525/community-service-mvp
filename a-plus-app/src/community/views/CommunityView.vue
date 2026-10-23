<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import type { PostMode } from '../types'
import PostCard from '../components/PostCard.vue'
import { buildShareUrl } from '../../shared/route-state'
import { copyText } from '../../shared/clipboard'

type FeedFilter = 'all' | PostMode

const props = withDefaults(defineProps<{
  initialQuery?: string
  initialFilter?: FeedFilter
  onlyOpenHelp?: boolean
  focusPostId?: string
}>(), {
  initialQuery: '',
  initialFilter: 'all',
  onlyOpenHelp: false,
  focusPostId: '',
})
const emit = defineEmits<{
  toast: [message: string]
  filterChange: [filter: FeedFilter]
  focusDone: []
  focusMissing: []
}>()
const store = useCommunityStore()
const activeFilter = ref<FeedFilter>(props.initialFilter)
const query = ref(props.initialQuery)
const onlyOpenHelp = ref(props.onlyOpenHelp)
const filters: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: '全部动态' }, { key: 'help', label: '互助求助' },
  { key: 'volunteer', label: '志愿动态' }, { key: 'neighbor', label: '邻里分享' },
]
watch(() => props.initialQuery, (value) => { query.value = value })
watch(() => props.initialFilter, (value) => { activeFilter.value = value })
watch(() => props.onlyOpenHelp, (value) => { onlyOpenHelp.value = value })
watch(() => props.focusPostId, async (value) => {
  if (!value) return
  activeFilter.value = 'all'
  query.value = ''
  onlyOpenHelp.value = false
  await nextTick()
  const card = document.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(value)}"]`)
  if (card) {
    card.scrollIntoView({ block: 'center' })
    card.focus({ preventScroll: true })
    card.classList.add('post-jump-highlight')
    window.setTimeout(() => card.classList.remove('post-jump-highlight'), 4000)
    emit('focusDone')
    return
  }
  // 深链目标可能未过审、已下架或已删除：交由上层清理地址并说明原因。
  emit('focusMissing')
}, { immediate: true })
/** 选择类型时同步地址（由上层 replace），并退出“只看待接单”这一仅本机的视图。 */
function selectFilter(key: FeedFilter) {
  const changed = activeFilter.value !== key || onlyOpenHelp.value
  activeFilter.value = key
  onlyOpenHelp.value = false
  if (changed) emit('filterChange', key)
}
/** 搜索无结果时恢复默认视图，只改本页筛选，不写存档。 */
function resetFilters() {
  activeFilter.value = 'all'
  query.value = ''
  onlyOpenHelp.value = false
  emit('filterChange', 'all')
}
/** 只复制页签与筛选；搜索词和演练身份留在本机。 */
async function copyViewLink() {
  const url = buildShareUrl({
    tab: 'community',
    filter: activeFilter.value === 'all' ? null : activeFilter.value,
  })
  const copied = await copyText(url)
  emit('toast', copied
    ? '已复制当前筛选链接（不含搜索词与演练身份）。'
    : '复制失败：请从地址栏复制链接。')
}

const visiblePosts = computed(() => store.visiblePosts
  .filter((post) => post.publishedToFeed !== false)
  .filter((post) => activeFilter.value === 'all' || post.mode === activeFilter.value)
  .filter((post) => !onlyOpenHelp.value || (post.mode === 'help' && post.orderStatus === 'open'))
  .filter((post) => !query.value.trim() || `${post.title} ${post.content} ${post.location} ${post.category ?? ''}`.toLowerCase().includes(query.value.trim().toLowerCase()))
  .slice()
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
</script>

<template>
  <div class="page-stack">
    <section class="community-intro"><div><span class="soft-label">NEIGHBORS, NEARBY</span><h1>社区动态</h1><p>把日常分享出来，互助就有了回声。求助、志愿与邻里分享均为虚构演练数据。</p></div><div class="intro-stamp"><span>QH</span><small>青禾里<br />演练社区</small></div></section>
    <p v-if="onlyOpenHelp" class="open-help-note">只显示尚未接单的求助 <button type="button" @click="selectFilter('all')">显示全部动态</button></p>
    <section class="feed-toolbar"><div class="filter-row" v-tablist role="tablist" aria-label="动态类型"><button v-for="filter in filters" :key="filter.key" type="button" role="tab" :aria-selected="activeFilter === filter.key" :class="{ selected: activeFilter === filter.key }" @click="selectFilter(filter.key)">{{ filter.label }}<span v-if="filter.key === 'all'"> {{ store.visiblePosts.filter((post) => post.publishedToFeed !== false).length }}</span></button></div><label class="search-box"><span>⌕</span><input v-model="query" type="search" placeholder="搜索动态" aria-label="搜索社区动态" /></label></section>
    <div class="result-line">
      <p class="result-status" role="status" aria-live="polite">当前显示 {{ visiblePosts.length }} 条动态{{ query.trim() ? "（已应用搜索）" : "" }}</p>
      <button class="copy-view-link" type="button" @click="copyViewLink">复制视图链接</button>
    </div>
    <div v-if="visiblePosts.length" class="feed-list"><PostCard v-for="post in visiblePosts" :key="post.id" :post="post" @toast="emit('toast', $event)" /></div>
    <div v-else class="empty-state">
      <span class="empty-icon" aria-hidden="true">◌</span>
      <h3>还没有找到动态</h3>
      <p>换个筛选条件，或发布一条新的演练内容。</p>
      <button class="button-ghost" type="button" @click="resetFilters">显示全部动态</button>
    </div>
    <p class="page-footnote">互动、接单和报名仅修改本机虚构演练数据，不会发送通知或触发真实服务。</p>
  </div>
</template>
