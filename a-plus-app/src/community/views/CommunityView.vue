<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import type { PostMode } from '../types'
import PostCard from '../components/PostCard.vue'

const props = withDefaults(defineProps<{
  initialQuery?: string
  initialFilter?: 'all' | PostMode
  onlyOpenHelp?: boolean
}>(), {
  initialQuery: '',
  initialFilter: 'all',
  onlyOpenHelp: false,
})
const emit = defineEmits<{ toast: [message: string] }>()
const store = useCommunityStore()
const activeFilter = ref<'all' | PostMode>(props.initialFilter)
const query = ref(props.initialQuery)
const onlyOpenHelp = ref(props.onlyOpenHelp)
const filters: { key: 'all' | PostMode; label: string }[] = [
  { key: 'all', label: '全部动态' }, { key: 'help', label: '互助求助' },
  { key: 'volunteer', label: '志愿动态' }, { key: 'neighbor', label: '邻里分享' },
]
watch(() => props.initialQuery, (value) => { query.value = value })
watch(() => props.initialFilter, (value) => { activeFilter.value = value })
watch(() => props.onlyOpenHelp, (value) => { onlyOpenHelp.value = value })
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
    <section class="community-intro"><div><span class="soft-label">NEIGHBORS, NEARBY</span><h2>把日常分享出来，<br /><em>互助就有了回声。</em></h2><p>求助、志愿动态和邻里分享都来自虚构演练数据。</p></div><div class="intro-stamp"><span>QH</span><small>青禾里<br />演练社区</small></div></section>
    <p v-if="onlyOpenHelp" class="open-help-note">只显示尚未接单的求助 <button type="button" @click="activeFilter = 'all'; onlyOpenHelp = false">显示全部动态</button></p>
    <section class="feed-toolbar"><div class="filter-row" role="tablist" aria-label="动态类型"><button v-for="filter in filters" :key="filter.key" type="button" role="tab" :aria-selected="activeFilter === filter.key" :class="{ selected: activeFilter === filter.key }" @click="activeFilter = filter.key; onlyOpenHelp = false">{{ filter.label }}<span v-if="filter.key === 'all'"> {{ store.visiblePosts.filter((post) => post.publishedToFeed !== false).length }}</span></button></div><label class="search-box"><span>⌕</span><input v-model="query" type="search" placeholder="搜索动态" aria-label="搜索社区动态" /></label></section>
    <div v-if="visiblePosts.length" class="feed-list"><PostCard v-for="post in visiblePosts" :key="post.id" :post="post" @toast="emit('toast', $event)" /></div>
    <div v-else class="empty-state"><span class="empty-icon">◌</span><h3>还没有找到动态</h3><p>换个筛选条件，或发布一条新的演练内容。</p></div>
    <p class="page-footnote">互动、接单和报名仅修改本机虚构演练数据，不会发送通知或触发真实服务。</p>
  </div>
</template>
