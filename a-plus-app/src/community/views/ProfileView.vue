<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { INTAKE_STORAGE_KEY } from '../../domain/intake-backup'
import { describeLatestIntakeActivity, readLocalIntakeProgress, type IntakeProgressSnapshot, type LocalIntakeProgress } from '../intake-progress'
import { useCommunityStore } from '../store'
import type { Post } from '../types'
import PostCard from '../components/PostCard.vue'

const emit = defineEmits<{ toast: [message: string]; navigate: [tab: 'community' | 'messages' | 'profile']; browseOpenHelp: [] }>()
const store = useCommunityStore()
const activeSection = ref<'posts' | 'favorites' | 'ledger' | 'orders'>('posts')
const demoUserId = 'SYNTH-DEMO-USER'
const intakeProgress = ref<IntakeProgressSnapshot>({ state: 'missing', records: [] })
const myPosts = computed(() => store.posts.filter((post) => post.author.id === demoUserId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const favoritePosts = computed(() => store.visiblePosts.filter((post) => post.favorited).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const myOrders = computed(() => store.posts
  .filter((post) => post.mode === 'help' && (post.author.id === demoUserId || post.acceptedByMe === true))
  .slice()
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const myMinutes = computed(() => store.ledger.reduce((sum, entry) => sum + entry.minutes, 0))
const intakeProgressByPostId = computed(() => new Map(
  intakeProgress.value.state === 'ready'
    ? intakeProgress.value.records.map((record) => [record.sourcePostId, record] as const)
    : [],
))

const sections = [
  { key: 'posts', label: '我的发布' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'orders', label: '服务记录' },
  { key: 'ledger', label: '时间账本' },
] as const

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours} 小时${remainder ? ` ${remainder} 分` : ''}` : `${remainder} 分钟`
}

function statusLabel(post: Post) {
  if ((post.moderation ?? 'pending') === 'pending') return '待审核，尚未公开'
  if (post.moderation === 'rejected') return '审核未通过'
  if (post.moderation === 'hidden') return '已下架'
  if (post.mode !== 'help') return '普通动态'
  if (post.acceptedByMe) return '我已演练接单'
  if (post.orderStatus === 'accepted-local-demo') return '已有人演练接单'
  return '等待演练接单'
}

function formatProgressDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function progressForPost(post: Post): LocalIntakeProgress | undefined {
  if (post.author.id !== demoUserId) return undefined
  return intakeProgressByPostId.value.get(post.id)
}

function latestProgressActivity(post: Post) {
  const progress = progressForPost(post)
  return progress ? describeLatestIntakeActivity(progress) : ''
}

function progressUpdatedAt(post: Post) {
  const progress = progressForPost(post)
  return progress ? formatProgressDate(progress.updatedAt) : ''
}

function refreshIntakeProgress(showNotice = false) {
  intakeProgress.value = readLocalIntakeProgress()
  if (showNotice) emit('toast', '已重新读取当前浏览器中的本机受理演练进度。')
}

function onIntakeStorageChange(event: StorageEvent) {
  if (event.key === INTAKE_STORAGE_KEY || event.key === null) refreshIntakeProgress()
}

function onIntakeWindowFocus() {
  refreshIntakeProgress()
}

function onIntakeVisibilityChange() {
  if (document.visibilityState === 'visible') refreshIntakeProgress()
}

onMounted(() => {
  refreshIntakeProgress()
  window.addEventListener('storage', onIntakeStorageChange)
  window.addEventListener('focus', onIntakeWindowFocus)
  document.addEventListener('visibilitychange', onIntakeVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', onIntakeStorageChange)
  window.removeEventListener('focus', onIntakeWindowFocus)
  document.removeEventListener('visibilitychange', onIntakeVisibilityChange)
})

function reloadData() {
  const result = store.reloadFromStorage()
  emit('toast', result.ok ? (result.message ?? '已重新载入最新存档。') : result.errors.join(' '))
}

function downloadUnreadableData() {
  const raw = store.unreadableStoredData
  if (raw === null) return

  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `community-unreadable-local-save-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  emit('toast', '已下载原始存档；请妥善保存后再决定是否重置。')
}

async function resetData() {
  const hasUnreadableData = store.storageStatus === 'recovery-required' || store.unreadableStoredData !== null
  try {
    await showConfirmDialog({
      title: hasUnreadableData ? '覆盖损坏存档并重置？' : '恢复演练数据？',
      message: hasUnreadableData
        ? '当前存档无法读取或版本不受支持。重置会覆盖这份损坏存档，覆盖后无法恢复；如需保留原文，请先“下载原始存档”。确认覆盖并恢复初始虚构示例吗？'
        : '本机新增的帖子、互动和反馈将被初始虚构示例覆盖。',
      confirmButtonText: hasUnreadableData ? '覆盖并重置' : '恢复数据',
      cancelButtonText: '取消',
      confirmButtonColor: '#2e6b52',
    })
  } catch {
    return
  }

  const result = store.resetDemoData()
  emit('toast', result.ok ? (result.message ?? '已恢复演示数据。') : result.errors.join(' '))
}
</script>

<template>
  <div class="page-stack profile-page">
    <section class="profile-hero">
      <div class="profile-avatar">禾</div>
      <div class="profile-intro"><span class="soft-label">YOUR LOCAL SPACE</span><h2>演练居民·禾禾</h2><p>虚构演练用户 · 青禾里（虚构）</p><span class="profile-tag"><i></i>合成资料</span></div>
      <div class="profile-illustration" aria-hidden="true"><span>✳</span><i></i><b></b></div>
    </section>

    <section class="profile-stat-grid" aria-label="演练数据统计">
      <div><strong>{{ myPosts.length.toString().padStart(2, '0') }}</strong><span>我的发布</span></div>
      <div><strong>{{ favoritePosts.length.toString().padStart(2, '0') }}</strong><span>收藏动态</span></div>
      <div><strong>{{ myOrders.length.toString().padStart(2, '0') }}</strong><span>服务记录</span></div>
      <div><strong>{{ formatMinutes(myMinutes) }}</strong><span>账本演示时长</span></div>
    </section>

    <section class="profile-storage-card" :class="{ 'is-conflict': store.storageStatus === 'conflict' }">
      <div class="storage-icon">▣</div>
      <div><strong>本机演练存档</strong><p v-if="store.storageStatus === 'saved'">已保存到当前浏览器。换浏览器或清理数据后不会自动迁移。</p><p v-else-if="store.storageStatus === 'conflict'">检测到其他标签页更新了本机存档。为避免覆盖较新的状态，已停止写入；请重新载入最新存档后再继续。</p><p v-else-if="store.storageStatus === 'recovery-required'">存档需要处理，原始内容已保留；当前不能写入。</p><p v-else-if="store.storageStatus === 'save-error'">最近一次写入失败，界面保留上一次成功保存的状态。</p><p v-else-if="store.storageStatus === 'memory-only'">当前只能保存在本次会话，刷新后可能丢失。</p><p v-else>首次使用；修改后保存在当前浏览器的本机演练数据中。</p><button v-if="store.storageStatus === 'recovery-required' && store.unreadableStoredData" type="button" class="button-ghost storage-reload" @click="downloadUnreadableData">下载原始存档</button><button v-if="store.storageStatus === 'conflict'" type="button" class="button-ghost storage-reload" @click="reloadData">重新载入</button></div>
      <button type="button" class="text-link" @click="resetData">重置演练数据</button>
    </section>

    <section class="profile-content-section">
      <div class="profile-tabs" role="tablist" aria-label="个人内容">
        <button v-for="section in sections" :key="section.key" type="button" role="tab" :aria-selected="activeSection === section.key" :class="{ selected: activeSection === section.key }" @click="activeSection = section.key">{{ section.label }}<span v-if="section.key === 'posts'">{{ myPosts.length }}</span><span v-else-if="section.key === 'favorites'">{{ favoritePosts.length }}</span><span v-else-if="section.key === 'orders'">{{ myOrders.length }}</span><span v-else>{{ store.ledger.length }}</span></button>
      </div>

      <div v-if="activeSection === 'posts'" class="profile-post-list">
        <article v-for="post in myPosts" :key="post.id" class="profile-post-row">
          <div class="profile-post-icon" :class="`kind-${post.mode}`">{{ post.mode === 'help' ? '↗' : post.mode === 'volunteer' ? '✳' : '⌂' }}</div>
          <div><strong>{{ post.title }}</strong><p>{{ post.mode === 'volunteer' && post.volunteerKind === 'activity' ? '志愿活动' : post.mode === 'volunteer' ? '志愿记录' : post.mode === 'help' ? '通用求助登记' : '邻里分享' }} · {{ post.publishedToFeed === false ? '仅自己可见' : '社区动态可见' }} · {{ statusLabel(post) }}</p></div>
          <span class="post-date">{{ new Date(post.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }}</span>
        </article>
        <div v-if="!myPosts.length" class="empty-state compact-empty"><h3>还没有发布内容</h3><p>发布的演练内容会显示在这里。</p></div>
      </div>

      <div v-else-if="activeSection === 'favorites'" class="feed-list profile-favorites">
        <PostCard v-for="post in favoritePosts" :key="post.id" :post="post" @toast="emit('toast', $event)" />
        <div v-if="!favoritePosts.length" class="empty-state compact-empty"><h3>还没有收藏</h3><p>在社区动态中点选星标后，会显示在这里。</p><button class="button-ghost" type="button" @click="emit('navigate', 'community')">去社区看看</button></div>
      </div>

      <div v-else-if="activeSection === 'orders'" class="profile-post-list">
        <section class="intake-progress-panel" aria-live="polite">
          <div class="intake-progress-panel-copy">
            <strong>A+ 受理进度（本机演练）</strong>
            <p v-if="intakeProgress.state === 'missing'">还没有检测到 A+ 受理演练存档。发布求助后，需要在工作台手动导入并登记。</p>
            <p v-else-if="intakeProgress.state === 'unavailable'">工作台存档暂时不可读取，进度未显示。请在工作台处理存档后再刷新；本页不会修改或覆盖它。</p>
            <p v-else>只读当前浏览器中与本人求助对应的受理演练记录；切回本页或刷新时会重新读取。</p>
          </div>
          <button class="button-ghost intake-progress-refresh" type="button" @click="refreshIntakeProgress(true)">刷新进度</button>
        </section>
        <article v-for="post in myOrders" :key="post.id" class="service-record-row">
          <div class="record-status" :class="{ done: post.orderStatus === 'accepted-local-demo' }"><i></i>{{ post.acceptedByMe ? '我接单' : '我发布' }} · {{ statusLabel(post) }}</div>
          <strong>{{ post.title }}</strong>
          <p>{{ post.timeWindow || '登记时段未填写' }} · {{ post.duration || '时长待确认' }}</p>
          <div v-if="progressForPost(post)" class="intake-progress-detail">
            <span class="intake-status-pill">{{ progressForPost(post)?.status }}</span>
            <p>{{ latestProgressActivity(post) }}</p>
            <small>最近更新 {{ progressUpdatedAt(post) }}</small>
          </div>
          <p v-else-if="post.author.id === demoUserId && intakeProgress.state === 'ready'" class="intake-progress-empty">尚无匹配的工作台受理记录；可到工作台从社区求助中手动导入。</p>
          <small>状态只用于本机流程演示，不代表真实接单、派单或履约。</small>
        </article>
        <div v-if="!myOrders.length" class="empty-state compact-empty"><h3>暂无服务记录</h3><p>发布求助或接单演练后，记录会显示在这里。</p><button class="button-ghost" type="button" @click="emit('browseOpenHelp')">去看看待接单求助</button></div>
      </div>

      <div v-else class="ledger-list">
        <article v-for="entry in store.ledger" :key="entry.id" class="ledger-entry">
          <span class="ledger-symbol">◷</span><div><strong>{{ entry.title }}</strong><p>{{ entry.note }}</p><small>{{ new Date(entry.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }} · {{ formatMinutes(entry.minutes) }}</small></div><span class="unsettled-badge">未核验</span>
        </article>
        <div v-if="!store.ledger.length" class="empty-state compact-empty">暂无虚构时间记录。</div>
        <p class="ledger-disclaimer">账本为只读演示，不代表真实服务时长；没有确认、兑换、结算或提现能力。</p>
      </div>
    </section>

    <section class="profile-help-row"><div><span class="soft-label">NEED A HAND?</span><h3>有想反馈的内容吗？</h3><p>反馈只保存在本机演练数据中。</p></div><button class="button-ghost" type="button" @click="emit('navigate', 'messages')">查看消息与反馈 <span>↗</span></button></section>
  </div>
</template>
