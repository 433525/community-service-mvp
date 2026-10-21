<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PostMode } from './types'
import HomeView from './views/HomeView.vue'
import CommunityView from './views/CommunityView.vue'
import PublishView from './views/PublishView.vue'
import MessagesView from './views/MessagesView.vue'
import ProfileView from './views/ProfileView.vue'
import ModerationView from './views/ModerationView.vue'
import { useCommunityStore } from './store'
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

const activeTab = ref<TabKey>('home')
const publishMode = ref<PostMode>('help')
const communityQuery = ref('')
const communityFilter = ref<'all' | PostMode>('all')
const onlyOpenHelp = ref(false)
const toastMessage = ref('')
let toastTimer: number | undefined

const activeTitle = computed(() => tabs.find((tab) => tab.key === activeTab.value)?.label ?? '首页')

function notify(message: string) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 2800)
}

function openPublish(mode: PostMode = 'help') {
  publishMode.value = mode
  activeTab.value = 'publish'
}

function navigateTab(tab: TabKey) {
  if (tab === 'community') {
    communityQuery.value = ''
    communityFilter.value = 'all'
    onlyOpenHelp.value = false
  }
  activeTab.value = tab
}

function openCommunitySearch(query: string, filter: 'all' | PostMode, openOnly = false) {
  communityQuery.value = query
  communityFilter.value = filter
  onlyOpenHelp.value = openOnly
  activeTab.value = 'community'
}
</script>

<template>
  <div class="community-app">
    <header class="topbar">
      <button class="brand" type="button" @click="navigateTab('home')" aria-label="返回首页">
        <span class="brand-mark"><span></span><span></span><span></span></span>
        <span class="brand-copy"><strong>邻里</strong><small>社区服务空间</small></span>
      </button>
      <div class="topbar-center"><span class="demo-dot"></span>合成数据演练版</div>
      <button class="topbar-message" type="button" @click="navigateTab('messages')">
        <span>▤</span><span class="topbar-message-label">消息</span>
      </button>
    </header>

    <div class="app-frame">
      <aside class="sidebar" aria-label="主导航">
        <div class="neighborhood-pill"><span>⌖</span> 青禾里 · 演练社区</div>
        <nav class="side-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :class="['nav-item', { active: activeTab === tab.key, 'nav-publish': tab.key === 'publish' }]"
            @click="navigateTab(tab.key)"
          >
            <span class="nav-icon">{{ tab.icon }}</span><span>{{ tab.label }}</span>
          </button>
        </nav>
        <div class="sidebar-note">
          <span class="note-star">✳</span>
          <strong>从一件小事开始</strong>
          <p>看看邻里动态，或登记一条通用求助。</p>
          <button type="button" @click="openPublish('help')">登记求助 <span>↗</span></button>
        </div>
        <div class="sidebar-foot"><span class="safe-seal">✓</span> 虚构资料 · 本机保存</div>
      </aside>

      <main class="main-column">
        <div class="page-heading">
          <div><p class="eyebrow">社区服务 · {{ activeTitle }}</p><h1>{{ activeTitle }}</h1></div>
          <div class="avatar-mini" aria-label="虚构演练用户">禾</div>
        </div>
        <div class="prototype-banner" role="note">
          <span class="banner-mark">i</span>
          <span><strong>本地演练空间</strong> · 姓名、社区、帖子和消息均为虚构；任何操作都不会联系真实居民或机构。</span>
        </div>

        <section class="membership-panel">
          <div><strong>B · 受控社区演练</strong><p>仅邀请或本社区实名核验成员可进入。此处只切换虚构身份，不采集姓名、证件或真实邀请码。</p></div>
          <label>演练身份<select :value="store.membership" @change="store.setMembership(($event.target as HTMLSelectElement).value as 'visitor' | 'member' | 'reviewer')"><option value="visitor">访客 · 未核验</option><option value="member">本社区已核验成员（合成）</option><option value="reviewer">审核员（合成）</option></select></label>
          <small>演示身份不构成安全权限。真实上线需服务端登录、成员核验和审核员授权。</small>
        </section>
        <ModerationView v-if="activeTab === 'moderation'" @toast="notify" />
        <div v-else-if="store.membership === 'visitor'" class="empty-state"><h3>这是受控社区</h3><p>请先切换为合成成员体验登记与互动。真实成员准入由运营方核验后开放。</p></div>
        <div v-else-if="store.membership === 'reviewer'" class="empty-state"><h3>审核员工作入口</h3><p>进入审核处理内容与举报；发布和接单请切回合成成员身份。</p><button class="button-primary" @click="activeTab = 'moderation'">进入审核后台</button></div>
        <HomeView v-else-if="activeTab === 'home'" @navigate="navigateTab" @community-search="openCommunitySearch" @publish="openPublish" @toast="notify" />
        <CommunityView v-else-if="activeTab === 'community'" :initial-query="communityQuery" :initial-filter="communityFilter" :only-open-help="onlyOpenHelp" @toast="notify" />
        <PublishView v-else-if="activeTab === 'publish'" :initial-mode="publishMode" @toast="notify" @published="navigateTab('profile')" />
        <MessagesView v-else-if="activeTab === 'messages'" @toast="notify" />
        <ProfileView v-else @toast="notify" @navigate="navigateTab" @browse-open-help="openCommunitySearch('', 'help', true)" />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="底部导航">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="[{ active: activeTab === tab.key }, { 'mobile-publish': tab.key === 'publish' }]"
        @click="navigateTab(tab.key)"
      >
        <span class="mobile-icon">{{ tab.icon }}</span><span>{{ tab.label }}</span>
      </button>
    </nav>
    <Transition name="toast"><div v-if="toastMessage" class="toast-message" role="status" aria-live="polite">{{ toastMessage }}</div></Transition>
  </div>
</template>
