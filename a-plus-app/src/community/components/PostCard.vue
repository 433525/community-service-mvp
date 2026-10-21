<script setup lang="ts">
import { ref } from 'vue'
import { useCommunityStore } from '../store'
import type { Post } from '../types'
import { SYNTHETIC_DEMO_AUTHOR } from '../fixtures'

const props = withDefaults(defineProps<{ post: Post; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ toast: [message: string] }>()
const store = useCommunityStore()
const showComment = ref(false)
const commentText = ref('')

const modeLabel = (mode: Post['mode']) => ({ help: '互助求助', volunteer: '志愿动态', neighbor: '邻里分享' })[mode]
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
const isMyHelpPost = props.post.mode === 'help' && props.post.author.id === SYNTHETIC_DEMO_AUTHOR.id

function run(action: () => { ok: boolean; errors: string[]; message?: string }, success: string) {
  const result = action()
  emit('toast', result.ok ? (result.message ?? success) : result.errors.join(' '))
}

function addComment() {
  const result = store.addComment(props.post.id, commentText.value)
  if (!result.ok) return emit('toast', result.errors.join(' '))
  commentText.value = ''
  emit('toast', '评论已保存在本机演练数据中。')
}
</script>

<template>
  <article class="post-card" :class="{ compact }">
    <div class="post-topline">
      <span class="post-kind" :class="`kind-${post.mode}`"><i></i>{{ modeLabel(post.mode) }}</span>
      <span class="post-date">{{ dateLabel(post.createdAt) }} · 演练</span>
    </div>
    <div class="post-author-row">
      <span class="post-avatar" :class="`avatar-${post.mode}`">{{ post.anonymous ? '匿' : post.author.name.slice(-2, -1) }}</span>
      <div><strong>{{ post.anonymous ? '匿名志愿者（虚构）' : post.author.name }}</strong><small>{{ post.location }}</small></div>
      <button class="icon-button post-save" type="button" :aria-label="post.favorited ? '取消收藏' : '收藏'" @click="run(() => store.toggleFavorite(post.id), post.favorited ? '已取消收藏。' : '已收藏。')">{{ post.favorited ? '★' : '☆' }}</button>
    </div>
    <h3 class="post-title">{{ post.title }}</h3>
    <p class="post-content">{{ post.content }}</p>
    <div v-if="post.mode === 'help' && (post.category || post.timeWindow || post.duration)" class="help-detail-row">
      <span v-if="post.category">分类：{{ post.category }}</span>
      <span v-if="post.timeWindow">时段：{{ post.timeWindow }}</span>
      <span v-if="post.duration">预计：{{ post.duration }}</span>
    </div>
    <div v-if="post.specialNote" class="post-note">补充说明：{{ post.specialNote }}</div>
    <div v-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="event-detail">
      <span>◷ {{ post.eventStartsAt ? new Date(post.eventStartsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间待定' }}</span>
      <span>报名 {{ post.eventSignupCount ?? 0 }}<template v-if="post.eventCapacity"> / {{ post.eventCapacity }} 人</template></span>
    </div>
    <div v-if="!compact" class="post-actions">
      <button type="button" :class="{ chosen: post.likedByMe }" @click="run(() => store.toggleLike(post.id), '已更新点赞。')"><span>♡</span>{{ post.likeCount }}</button>
      <button type="button" @click="showComment = !showComment"><span>▱</span>{{ post.comments.length }} 条评论</button>
      <button v-if="post.mode === 'help'" class="post-action-cta" type="button" :disabled="post.orderStatus !== 'open' || isMyHelpPost" @click="run(() => store.acceptOrder(post.id), '已在本机演练中标记接单。')">{{ isMyHelpPost ? '我的求助' : post.acceptedByMe ? '我已接单' : post.orderStatus === 'accepted-local-demo' ? '已有人接单' : '演练接单' }}</button>
      <button v-else-if="post.mode === 'volunteer' && post.volunteerKind === 'activity'" class="post-action-cta" type="button" :disabled="!!post.signedUpByMe || (!!post.eventCapacity && (post.eventSignupCount ?? 0) >= post.eventCapacity)" @click="run(() => store.signUpForEvent(post.id), '已在本机演练中记录报名。')">{{ post.signedUpByMe ? '已演练报名' : '演练报名' }}</button>
      <span v-else class="local-action-label">仅本机互动</span>
    </div>
    <div v-if="showComment && !compact" class="comment-panel">
      <div v-if="post.comments.length" class="comment-list">
        <p v-for="comment in post.comments.slice(-2)" :key="comment.id"><strong>{{ comment.author.name }}：</strong>{{ comment.content }}</p>
      </div>
      <form class="comment-form" @submit.prevent="addComment">
        <label class="sr-only" :for="`comment-${post.id}`">写一条演练评论</label>
        <input :id="`comment-${post.id}`" v-model="commentText" placeholder="写一条演练评论…" maxlength="1000" />
        <button type="submit" :disabled="!commentText.trim()">发送</button>
      </form>
      <small>评论只会保存在当前浏览器的演练数据中。</small>
    </div>
  </article>
</template>
