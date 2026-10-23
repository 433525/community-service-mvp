<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useCommunityStore } from '../store'
import type { PostMode } from '../types'
import PostCard from '../components/PostCard.vue'
import HomeBanner from '../components/HomeBanner.vue'
import type { BannerAction } from '../banner-slides'

const emit = defineEmits<{
  navigate: [tab: 'community' | 'messages' | 'profile']
  communitySearch: [query: string, filter: 'all' | PostMode, onlyOpenHelp?: boolean]
  communityPost: [id: string]
  publish: [mode: PostMode]
  toast: [message: string]
}>()
const store = useCommunityStore()
const showSafety = ref(false)
const safetyDialog = ref<HTMLElement | null>(null)
let safetyReturnFocus: HTMLElement | null = null
const searchQuery = ref('')
const searchFilter = ref<'all' | PostMode>('all')
const now = new Date()
const todayLabel = `${new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(now)} · ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(now)}`
const feed = computed(() => store.visiblePosts.filter((post) => post.publishedToFeed !== false).slice(0, 2))
const openHelpCount = computed(() => store.visiblePosts.filter((post) => post.mode === 'help' && post.orderStatus === 'open' && post.publishedToFeed !== false).length)
const activeOrderCount = computed(() => store.posts.filter((post) => post.mode === 'help'
  && (post.author.id === 'SYNTH-DEMO-USER' || post.acceptedByMe === true)
  && ['accepted-local-demo', 'completion-requested', 'disputed-local-demo'].includes(post.orderStatus ?? '')).length)
const activityCount = computed(() => store.posts.filter((post) => post.mode === 'volunteer'
  && post.volunteerKind === 'activity' && post.signedUpByMe === true).length)
const unreadNoticeCount = computed(() => store.unreadNoticeCount)
const searchFilters: { key: 'all' | PostMode; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'help', label: '求助' },
  { key: 'volunteer', label: '志愿' }, { key: 'neighbor', label: '邻里' },
]
const searchMatches = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return store.visiblePosts
    .filter((post) => post.publishedToFeed !== false)
    .filter((post) => searchFilter.value === 'all' || post.mode === searchFilter.value)
    .filter((post) => !query || `${post.title} ${post.content} ${post.location} ${post.category ?? ''}`.toLocaleLowerCase().includes(query))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})
const showSearchMatches = computed(() => !!searchQuery.value.trim() || searchFilter.value !== 'all')

function choose(mode: PostMode) { emit('publish', mode) }
function openCommunitySearch(filter: 'all' | PostMode = searchFilter.value, onlyOpenHelp = false) {
  emit('communitySearch', searchQuery.value.trim(), filter, onlyOpenHelp)
}

/** 公告轮播的入口都走已有页签/弹层，不新增路由，也不触发任何外部请求。 */
function onBannerAction(action: BannerAction, event: MouseEvent) {
  if (action.kind === 'community') emit('navigate', 'community')
  else if (action.kind === 'profile') emit('navigate', 'profile')
  else if (action.kind === 'safety') openSafety(event)
  else if (action.kind === 'publish') emit('publish', action.mode)
  else emit('communitySearch', '', action.filter)
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )).filter((node) => !node.hasAttribute('disabled'))
}

function openSafety(event?: MouseEvent) {
  const trigger = event?.currentTarget
  safetyReturnFocus = trigger instanceof HTMLElement ? trigger : null
  showSafety.value = true
  nextTick(() => {
    const preferred = safetyDialog.value?.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? focusableIn(safetyDialog.value)[0])?.focus()
  })
}

function closeSafety() {
  showSafety.value = false
  const target = safetyReturnFocus
  safetyReturnFocus = null
  nextTick(() => target?.focus?.())
}

function onSafetyKeydown(event: KeyboardEvent) {
  if (!showSafety.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSafety()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableIn(safetyDialog.value)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="page-stack">
    <div class="home-main-content" :inert="showSafety">
    <section class="welcome-row">
      <div><span class="soft-label"><i></i> {{ todayLabel }}</span><h1>你好，演练居民 <span>👋</span></h1><p>今天想为邻里做点什么？</p></div>
      <button class="weather-chip" type="button" @click="emit('toast', '天气卡片仅用于界面演示，不读取设备位置或实时天气。')"><span aria-hidden="true">◒</span><span>邻里晴好<small>演示天气</small></span></button>
    </section>

    <section class="home-todo" aria-label="我的待办">
      <button type="button" @click="emit('navigate', 'profile')"><strong>{{ activeOrderCount.toString().padStart(2, '0') }}</strong><span><small>进行中订单</small><em>我的 → 服务记录</em></span></button>
      <button type="button" @click="emit('navigate', 'messages')"><strong>{{ unreadNoticeCount.toString().padStart(2, '0') }}</strong><span><small>未读通知</small><em>消息 → 系统通知</em></span></button>
      <button type="button" @click="emit('navigate', 'profile')"><strong>{{ activityCount.toString().padStart(2, '0') }}</strong><span><small>已报名活动</small><em>我的 → 我的活动</em></span></button>
    </section>

    <HomeBanner @action="onBannerAction" />

    <section class="hero-card">
      <div class="hero-text"><span class="hero-kicker">A LITTLE HELP, CLOSE TO HOME</span><h2>让互助<br />就在邻里之间。</h2><p>看看附近的演练动态，或登记一条通用求助。</p><div class="hero-actions"><button class="button-primary" type="button" @click="choose('help')">发布求助 <span>↗</span></button><button class="button-ghost-light" type="button" @click="emit('navigate', 'community')">浏览社区</button></div></div>
      <div class="hero-art" aria-hidden="true"><div class="sun-disc"></div><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-house house-main"><span></span><i></i></div><div class="hero-house house-small"><span></span><i></i></div><div class="hero-leaf leaf-one"></div><div class="hero-leaf leaf-two"></div><div class="hero-label label-one">帮一把</div><div class="hero-label label-two">在一起</div></div>
      <div class="hero-foot"><span>01 / COMMUNITY</span><span>所有内容均为虚构演示</span></div>
    </section>

    <section class="home-feed-section">
      <div class="section-heading"><div><span class="soft-label">FROM YOUR COMMUNITY</span><h2>邻里新鲜事</h2></div><button class="text-link" type="button" @click="emit('navigate', 'community')">查看全部 <span>→</span></button></div>
      <div class="feed-list"><PostCard v-for="post in feed" :key="post.id" :post="post" compact @toast="emit('toast', $event)" /></div>
      <div v-if="feed.length === 0" class="empty-state">还没有公开的演练动态。发布并审核通过后可在这里查看。</div>
    </section>

    <section class="quick-grid" aria-label="服务入口">
      <button class="quick-card quick-help" type="button" @click="choose('help')"><span class="quick-icon">↗</span><span><strong>我需要帮助</strong><small>通用登记 · 服务类型待分类</small></span><b>→</b></button>
      <button class="quick-card quick-volunteer" type="button" @click="choose('volunteer')"><span class="quick-icon">✳</span><span><strong>我想做志愿</strong><small>分享动态或发起活动</small></span><b>→</b></button>
      <button class="quick-card quick-neighbor" type="button" @click="choose('neighbor')"><span class="quick-icon">⌂</span><span><strong>邻里分享</strong><small>交换信息与日常互助</small></span><b>→</b></button>
    </section>


    <section class="home-search-section">
      <div class="section-heading"><div><span class="soft-label">FIND LOCAL DEMO POSTS</span><h2>找服务与邻里动态</h2></div><span class="demo-caption">只搜索本机合成数据</span></div>
      <form class="home-search-form" @submit.prevent="openCommunitySearch()">
        <label class="search-box"><span>⌕</span><input v-model="searchQuery" type="search" placeholder="搜索求助、志愿活动或关键词" aria-label="搜索社区服务与动态" /></label>
        <button class="home-search-submit" type="submit">搜索动态 <span>→</span></button>
      </form>
      <div class="home-search-controls">
        <div class="home-search-filters" v-tablist role="tablist" aria-label="搜索动态类型">
          <button v-for="filter in searchFilters" :key="filter.key" type="button" role="tab" :aria-selected="searchFilter === filter.key" :class="{ selected: searchFilter === filter.key }" @click="searchFilter = filter.key">{{ filter.label }}</button>
        </div>
        <button class="home-help-link" type="button" @click="openCommunitySearch('help', true)">查看待接单求助 <span>↗</span></button>
      </div>
      <div v-if="showSearchMatches" class="home-search-results">
        <p v-if="searchMatches.length" class="home-search-count" role="status" aria-live="polite">找到 {{ searchMatches.length }} 条演练动态，显示最近 4 条</p>
        <button v-for="post in searchMatches.slice(0, 4)" :key="post.id" class="home-search-result" type="button" @click="emit('communityPost', post.id)">
          <span class="home-result-kind" :class="`kind-${post.mode}`">{{ post.mode === 'help' ? '求助' : post.mode === 'volunteer' ? '志愿' : '邻里' }}</span>
          <span class="home-result-copy"><strong>{{ post.title }}</strong><small>{{ post.location }} · {{ new Date(post.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }}</small></span>
          <b>→</b>
        </button>
        <div v-if="!searchMatches.length" class="home-search-empty">没有匹配的演练动态，试试更短的关键词。</div>
      </div>
    </section>

    <section class="home-summary-row">
      <div class="section-heading"><div><span class="soft-label">TODAY AT QINGHELI</span><h2>社区一览</h2></div><span class="demo-caption">虚构演练数据</span></div>
      <div class="summary-grid">
        <div class="summary-tile"><span class="summary-icon mint">↗</span><div><strong>{{ openHelpCount.toString().padStart(2, '0') }}</strong><small>待接单求助</small></div><span class="summary-arrow">↗</span></div>
        <div class="summary-tile"><span class="summary-icon peach">✳</span><div><strong>{{ store.visiblePosts.filter((post) => post.mode === 'volunteer').length.toString().padStart(2, '0') }}</strong><small>志愿活动与记录</small></div><span class="summary-arrow">↗</span></div>
        <div class="summary-tile"><span class="summary-icon blue">◉</span><div><strong>{{ store.visiblePosts.filter((post) => post.publishedToFeed !== false).length.toString().padStart(2, '0') }}</strong><small>社区动态</small></div><span class="summary-arrow">↗</span></div>
      </div>
    </section>


    <section class="care-strip">
      <div class="care-symbol" aria-hidden="true">✳</div><div><span class="soft-label">NEED URGENT HELP?</span><h3>安全提示与紧急信息</h3><p>这个原型不会呼叫、定位或通知任何人。</p></div><button type="button" @click="openSafety">查看说明 <span>↗</span></button>
    </section>
    </div>
    <div v-if="showSafety" class="modal-backdrop" @click.self="closeSafety"><section ref="safetyDialog" class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="safety-title" aria-describedby="safety-lead" @keydown="onSafetyKeydown"><button class="dialog-close" type="button" aria-label="关闭安全说明" @click="closeSafety">×</button><span class="soft-label">安全说明</span><h2 id="safety-title">这不是紧急求助通道</h2><p id="safety-lead">本页面不会拨打电话、读取位置、推送给管理员，也不会通知任何机构。遇到现实紧急情况，请使用当地正式紧急服务渠道。</p><button class="button-primary" type="button" data-autofocus @click="closeSafety">我知道了</button></section></div>
  </div>
</template>
