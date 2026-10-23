<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import type { PostMode } from './types'
import HomeView from './views/HomeView.vue'
import CommunityView from './views/CommunityView.vue'
import { asyncView } from './async-view'

// 页签级按需加载：首屏只含首页与社区，其余页签首次进入时再取分块。
const PublishView = asyncView(() => import('./views/PublishView.vue'))
const MessagesView = asyncView(() => import('./views/MessagesView.vue'))
const ProfileView = asyncView(() => import('./views/ProfileView.vue'))
const ModerationView = asyncView(() => import('./views/ModerationView.vue'))
import { useCommunityStore } from './store'
import { readReadingMode, writeReadingMode } from './reading-mode'
import { APP_ERROR_EVENT } from '../shared/error-reporting'
import { onRoutePop, readRouteParam, routeSignature, writeRoute } from '../shared/route-state'
import OfflineNotice from '../shared/components/OfflineNotice.vue'
const store = useCommunityStore()

type TabKey = 'home' | 'community' | 'publish' | 'messages' | 'profile' | 'moderation'

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'home', label: '首页', icon: '⌂' },
  { key: 'community', label: '社区', icon: '◉' },
  { key: 'publish', label: '发布', icon: '+' },
  { key: 'messages', label: '消息', icon: '▤' },
  { key: 'profile', label: '我的', icon: '◌' },
  { key: 'moderation', label: '审核', icon: '✓' },
]

function isTabKey(value: string): value is TabKey {
  return tabs.some((tab) => tab.key === value)
}

// 页签与目标动态来自查询串：链接可分享、刷新可还原、前进/后退可用。
// 默认首页不写参数，保持 `/community.html` 干净。
// 社区筛选只允许四个白名单值：搜索词与演练身份不入 URL，避免把本机输入带进分享链接。
type FeedFilter = 'all' | PostMode
const feedFilters: FeedFilter[] = ['all', 'help', 'volunteer', 'neighbor']
function isFeedFilter(value: string): value is FeedFilter {
  return feedFilters.includes(value as FeedFilter)
}
const initialTabParam = readRouteParam('tab')
const initialPostParam = readRouteParam('post')
const initialFilterParam = readRouteParam('filter')
const activeTab = ref<TabKey>(isTabKey(initialTabParam)
  ? initialTabParam
  : (initialPostParam || isFeedFilter(initialFilterParam) ? 'community' : 'home'))
const publishMode = ref<PostMode>('help')
const communityQuery = ref('')
const communityFilter = ref<FeedFilter>(isFeedFilter(initialFilterParam) ? initialFilterParam : 'all')
const onlyOpenHelp = ref(false)
const communityFocusId = ref(activeTab.value === 'community' ? initialPostParam : '')
const routeAnnouncement = ref('')
let lastRouteSignature = routeSignature()
let stopRoutePop: (() => void) | null = null
const toastMessage = ref('')
const toastIsError = computed(() => /失败|错误|请先|请填写|不能|无效|已达|上限|无法|未保存|已停止|不可用|拒绝/.test(toastMessage.value))
const readingLarge = ref(readReadingMode() === 'large')
const showHelp = ref(false)
const helpDialog = ref<HTMLElement | null>(null)
let helpReturnFocus: HTMLElement | null = null
const unreadCount = computed(() => store.unreadNoticeCount)
const unreadLabel = computed(() => unreadCount.value > 9 ? '9+' : String(unreadCount.value))
let toastTimer: number | undefined

function onAppError(event: Event) {
  const detail = (event as CustomEvent<{ message?: string }>).detail
  notify(detail?.message ?? '界面出现异常，请刷新后重试。')
}
onMounted(() => {
  window.addEventListener(APP_ERROR_EVENT, onAppError)
  stopRoutePop = onRoutePop(onRoutePopState)
  applyRouteFromLocation({ initial: true })
})
onBeforeUnmount(() => {
  window.removeEventListener(APP_ERROR_EVENT, onAppError)
  stopRoutePop?.()
  window.clearTimeout(toastTimer)
})

function toggleReadingMode() {
  readingLarge.value = !readingLarge.value
  const saved = writeReadingMode(readingLarge.value ? 'large' : 'normal')
  notify(saved
    ? (readingLarge.value ? '已开启大字阅读模式（仅保存在当前浏览器）。' : '已恢复常规字号。')
    : '当前浏览器无法保存字号偏好，本次变化只在当前会话生效。')
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )).filter((node) => !node.hasAttribute('disabled'))
}

function openHelp(event?: MouseEvent) {
  const trigger = event?.currentTarget
  helpReturnFocus = trigger instanceof HTMLElement ? trigger : null
  showHelp.value = true
  nextTick(() => {
    const preferred = helpDialog.value?.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? focusableIn(helpDialog.value)[0])?.focus()
  })
}

function closeHelp() {
  showHelp.value = false
  const target = helpReturnFocus
  helpReturnFocus = null
  nextTick(() => target?.focus?.())
}

function onHelpKeydown(event: KeyboardEvent) {
  if (!showHelp.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeHelp()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableIn(helpDialog.value)
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

const activeTitle = computed(() => tabs.find((tab) => tab.key === activeTab.value)?.label ?? '首页')

// 页签标题：未读数量作前缀 + 当前页签名 + 演练版名称，例如「(3) 消息 · 邻里社区服务演练版」。
// 必须放在 activeTitle 定义之后：watchEffect 会同步执行一次，提前读取 computed 会触发 TDZ。
watchEffect(() => {
  if (typeof document === 'undefined') return
  const pageTitle = `${activeTitle.value} · 邻里 · 社区服务演练版`
  document.title = unreadCount.value ? `(${unreadCount.value}) ${pageTitle}` : pageTitle
})

function notify(message: string) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  // Long validation or recovery messages need more time to read than a short toast.
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, message.length > 60 ? 6500 : 2800)
}

function resetScroll() {
  if (typeof window !== 'undefined') window.scrollTo(0, 0)
}

/** 屏幕阅读器播报页签变化；先清空再写入，连续切换同一页签也能重新播报。 */
function announceRoute(tab: TabKey) {
  const label = tabs.find((item) => item.key === tab)?.label ?? '首页'
  routeAnnouncement.value = ''
  nextTick(() => { routeAnnouncement.value = `已切换到${label}页` })
}

function syncRoute(tab: TabKey, post: string | null, options: { replace?: boolean } = {}) {
  // 只把社区筛选写进地址：搜索词、身份、只看待接单等本机视图状态不进入分享链接。
  const filter = tab === 'community' && communityFilter.value !== 'all' ? communityFilter.value : null
  const changed = writeRoute(
    { tab: tab === 'home' ? null : tab, post: post || null, filter },
    { ...options, clearHash: true },
  )
  if (changed) lastRouteSignature = routeSignature()
}

/** 只处理影响页签/目标帖子的地址变化；页内锚点后退时查询串不变，直接忽略。 */
function onRoutePopState() {
  const signature = routeSignature()
  if (signature === lastRouteSignature) return
  lastRouteSignature = signature
  applyRouteFromLocation()
}

function applyRouteFromLocation(options: { initial?: boolean } = {}) {
  const tabParam = readRouteParam('tab')
  const postParam = readRouteParam('post')
  const filterParam = readRouteParam('filter')
  const validFilter = isFeedFilter(filterParam)
  const nextTab: TabKey = isTabKey(tabParam) ? tabParam : (postParam || validFilter ? 'community' : 'home')
  const tabChanged = activeTab.value !== nextTab
  if (tabChanged) activeTab.value = nextTab
  if (postParam && nextTab === 'community') communityFocusId.value = postParam
  // 筛选只在社区页生效；其它页签的 filter 参数在首次加载时清理，避免地址自我矛盾。
  if (nextTab === 'community') communityFilter.value = validFilter ? filterParam : 'all'

  if (options.initial) {
    if (tabParam && !isTabKey(tabParam)) {
      syncRoute(nextTab, postParam, { replace: true })
      notify('链接中的页签不存在，已打开可用页面。')
    } else if (postParam && nextTab !== 'community') {
      syncRoute(nextTab, null, { replace: true })
    } else if (filterParam && !validFilter) {
      syncRoute(nextTab, postParam, { replace: true })
      if (nextTab === 'community') notify('链接中的筛选条件不存在，已显示全部动态。')
    } else if (filterParam && nextTab !== 'community') {
      syncRoute(nextTab, postParam, { replace: true })
    } else if (!tabParam && (postParam || validFilter)) {
      // 只有 post/filter 的链接也能还原页面，但补上 tab 让地址自解释。
      syncRoute(nextTab, postParam, { replace: true })
    }
    return
  }

  if (tabChanged) {
    announceRoute(nextTab)
    resetScroll()
    nextTick(() => {
      document.getElementById('community-main')?.focus({ preventScroll: true })
    })
  }
}

/** 筛选变化用 replace：不把每一次点选都变成一条历史记录，但刷新/复制仍能还原。 */
function onCommunityFilterChange(value: FeedFilter) {
  communityFilter.value = value
  syncRoute('community', null, { replace: true })
}

/** 深链指向的动态不存在、未过审或已下架时，回到干净的社区地址。 */
function onCommunityFocusMissing() {
  communityFocusId.value = ''
  syncRoute('community', null, { replace: true })
  notify('该链接指向的动态不存在、未通过审核或已下架。')
}

function openPublish(mode: PostMode = 'help') {
  publishMode.value = mode
  activeTab.value = 'publish'
  syncRoute('publish', null)
  announceRoute('publish')
  resetScroll()
}

function navigateTab(tab: TabKey) {
  if (tab === 'community') {
    communityQuery.value = ''
    communityFilter.value = 'all'
    onlyOpenHelp.value = false
  }
  activeTab.value = tab
  syncRoute(tab, null)
  announceRoute(tab)
  resetScroll()
}

function openCommunitySearch(query: string, filter: 'all' | PostMode, openOnly = false) {
  communityQuery.value = query
  communityFilter.value = filter
  onlyOpenHelp.value = openOnly
  activeTab.value = 'community'
  syncRoute('community', null)
  announceRoute('community')
  resetScroll()
}

function openCommunityPost(id: string) {
  communityFocusId.value = id
  communityQuery.value = ''
  communityFilter.value = 'all'
  onlyOpenHelp.value = false
  activeTab.value = 'community'
  syncRoute('community', id)
  announceRoute('community')
}
</script>

<template>
  <div class="community-app" :class="{ 'reading-large': readingLarge }">
    <a class="skip-link" href="#community-main">跳到主内容</a>
    <p class="sr-only" role="status" aria-live="polite">{{ routeAnnouncement }}</p>
    <header class="topbar" :inert="showHelp">
      <button class="brand" type="button" @click="navigateTab('home')" aria-label="返回首页">
        <span class="brand-mark"><span></span><span></span><span></span></span>
        <span class="brand-copy"><strong>邻里</strong><small>社区服务空间</small></span>
      </button>
      <div class="topbar-center"><span class="demo-dot"></span>合成数据演练版</div>
      <div class="topbar-right">
        <button class="help-toggle" type="button" :aria-expanded="showHelp" aria-label="打开使用说明与演练边界" title="使用说明" @click="openHelp"><span aria-hidden="true">?</span><span class="help-toggle-label">说明</span></button>
        <button class="reading-toggle" type="button" :aria-pressed="readingLarge" :aria-label="readingLarge ? '当前为大字阅读模式，点击切换为常规字号' : '当前为常规字号，点击切换为大字阅读模式'" :title="readingLarge ? '切换为常规字号' : '切换为大字阅读模式'" @click="toggleReadingMode"><span aria-hidden="true">字</span><span class="reading-toggle-label">{{ readingLarge ? '常规' : '大字' }}</span></button>
        <button class="topbar-message" type="button" :aria-label="unreadCount ? `消息，${unreadCount} 条未读通知` : '消息'" @click="navigateTab('messages')">
          <span>▤</span><span class="topbar-message-label">消息</span>
          <span v-if="unreadCount" class="nav-badge" aria-hidden="true">{{ unreadLabel }}</span>
        </button>
      </div>
    </header>

    <div class="app-frame" :inert="showHelp">
      <aside class="sidebar" aria-label="主导航">
        <div class="neighborhood-pill"><span>⌖</span> 青禾里 · 演练社区</div>
        <nav class="side-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :class="['nav-item', { active: activeTab === tab.key, 'nav-publish': tab.key === 'publish' }]"
            :aria-current="activeTab === tab.key ? 'page' : undefined"
            @click="navigateTab(tab.key)"
          >
            <span class="nav-icon" aria-hidden="true">{{ tab.icon }}</span><span class="nav-label">{{ tab.label }}</span>
            <span v-if="tab.key === 'messages' && unreadCount" class="nav-badge" aria-hidden="true">{{ unreadLabel }}</span>
          </button>
        </nav>
        <div class="sidebar-note">
          <span class="note-star">✳</span>
          <strong>从一件小事开始</strong>
          <p>看看邻里动态，或登记一条通用求助。</p>
          <button type="button" @click="openPublish('help')">登记求助 <span>↗</span></button>
        </div>
        <div class="sidebar-foot"><span class="safe-seal">✓</span> 虚构资料 · 本机保存</div>
        <a class="sidebar-entry" href="/">内部受理工作台 <span aria-hidden="true">↗</span></a>
      </aside>

      <main id="community-main" class="main-column" tabindex="-1">
        <div class="page-chrome">
          <p class="breadcrumb">社区服务 <span>/</span> {{ activeTitle }}</p>
          <div class="avatar-mini" aria-label="虚构演练用户">禾</div>
        </div>
        <div class="prototype-banner" role="note">
          <span class="banner-mark" aria-hidden="true">i</span>
          <span><strong>本地演练空间</strong> · 社区、帖子与消息均为虚构，操作不会联系真实居民或机构。</span>
        </div>

        <section class="membership-panel" aria-label="演练身份与准入边界">
          <div class="membership-copy"><strong>B · 受控社区演练</strong><p>仅邀请或本社区实名核验成员可进入；此处只切换虚构身份，不采集姓名、证件或邀请码。</p></div>
          <label>演练身份<select :value="store.membership" @change="store.setMembership(($event.target as HTMLSelectElement).value as 'visitor' | 'member' | 'reviewer')"><option value="visitor">访客 · 未核验</option><option value="member">本社区已核验成员（合成）</option><option value="reviewer">审核员（合成）</option></select></label>
          <small>演示身份不构成安全权限；真实上线需服务端登录、成员核验与审核员授权。</small>
        </section>
        <ModerationView v-if="activeTab === 'moderation'" @toast="notify" />
        <div v-else-if="store.membership === 'visitor'" class="empty-state"><h1 class="gate-title">这是受控社区</h1><p>请先切换为合成成员体验登记与互动。真实成员准入由运营方核验后开放。</p></div>
        <div v-else-if="store.membership === 'reviewer'" class="empty-state"><h1 class="gate-title">审核员工作入口</h1><p>进入审核处理内容与举报；发布和接单请切回合成成员身份。</p><button class="button-primary" @click="activeTab = 'moderation'">进入审核后台</button></div>
        <HomeView v-else-if="activeTab === 'home'" @navigate="navigateTab" @community-search="openCommunitySearch" @community-post="openCommunityPost" @publish="openPublish" @toast="notify" />
        <CommunityView v-else-if="activeTab === 'community'" :initial-query="communityQuery" :initial-filter="communityFilter" :only-open-help="onlyOpenHelp" :focus-post-id="communityFocusId" @toast="notify" @filter-change="onCommunityFilterChange" @focus-done="communityFocusId = ''" @focus-missing="onCommunityFocusMissing" />
        <PublishView v-else-if="activeTab === 'publish'" :initial-mode="publishMode" @toast="notify" @published="navigateTab('profile')" />
        <MessagesView v-else-if="activeTab === 'messages'" @toast="notify" @browse-open-help="openCommunitySearch('', 'help', true)" />
        <ProfileView v-else @toast="notify" @navigate="navigateTab" @browse-open-help="openCommunitySearch('', 'help', true)" @open-post="openCommunityPost" />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="底部导航" :inert="showHelp">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="[{ active: activeTab === tab.key }, { 'mobile-publish': tab.key === 'publish' }]"
        :aria-current="activeTab === tab.key ? 'page' : undefined"
        @click="navigateTab(tab.key)"
      >
        <span class="mobile-icon" aria-hidden="true">{{ tab.icon }}</span><span>{{ tab.label }}</span>
        <em v-if="tab.key === 'messages' && unreadCount" class="mobile-badge" aria-hidden="true">{{ unreadLabel }}</em>
      </button>
    </nav>
    <div v-if="showHelp" class="modal-backdrop" @click.self="closeHelp">
      <section ref="helpDialog" class="dialog-card help-dialog" role="dialog" aria-modal="true" aria-labelledby="community-help-title" aria-describedby="community-help-lead" @keydown="onHelpKeydown">
        <button class="dialog-close" type="button" aria-label="关闭使用说明" @click="closeHelp">×</button>
        <span class="soft-label">HOW THIS DEMO WORKS</span>
        <h2 id="community-help-title">使用说明（合成演练）</h2>
        <p id="community-help-lead" class="help-lead">这是学校大创项目的本地合成数据原型：所有姓名、社区、帖子、订单、消息和举报均为虚构，只保存在当前浏览器；不会连接真实居民、机构、支付或配送服务。</p>
        <div class="help-grid">
          <section><h3>1. 切换演练身份</h3><p>顶部“演练身份”可切换访客 / 成员 / 审核员。切换不是登录，也不提供真实权限；访客看不到社区正文，发布和互动需要成员身份。</p></section>
          <section><h3>2. 发布与审核</h3><p>发布内容先进入待审，审核员填写理由后通过、驳回或下架；通过且公开的内容才进入社区信息流。发布表单会自动保存本机草稿，但每次提交前仍需勾选虚构内容确认。</p></section>
          <section><h3>3. 求助订单履约演练</h3><p>求助单可走“接单 → 申请完成 → 确认完成”，也可取消或发起争议。双方流程用明确标注的“代合成对方”按钮代演；对方是合成对象，不会收到通知，也不代表真实履约、双方确认或结算。</p></section>
          <section><h3>4. 消息、通知与举报</h3><p>订单完成或关闭后留言只读；“消息”页显示本机系统通知和未读数；举报会在本机去重并留下审核日志，处理举报不会自动下架内容。</p></section>
          <section><h3>5. 存档与恢复</h3><p>数据保存在当前浏览器 localStorage；“我的”可查看只读 JSON 快照。存档损坏时会停止写入并保留原文，可下载原文后再重置。换浏览器或清理站点数据不会自动迁移。</p></section>
          <section><h3>6. 字号与安全边界</h3><p>顶栏“字”可切换大字阅读模式，偏好只保存在本机。本原型不是紧急求助通道：遇到现实紧急情况，请使用当地正式紧急服务渠道。</p></section>
        </div>
        <div class="help-foot"><small>不会发送通知、外发消息、派单、调度或结算；真实运营前需另行完成服务端、权限、数据治理与运营批准。</small><button class="button-primary" type="button" data-autofocus @click="closeHelp">我知道了</button></div>
      </section>
    </div>
    <Transition name="toast"><div v-if="toastMessage" class="toast-message" :role="toastIsError ? 'alert' : 'status'" :aria-live="toastIsError ? 'assertive' : 'polite'">{{ toastMessage }}</div></Transition>
    <OfflineNotice />
  </div>
</template>
