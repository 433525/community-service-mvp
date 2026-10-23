<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useCommunityStore } from '../store'
import type { PostMode } from '../types'
import {
  clearPublishDraft,
  readPublishDraft,
  writePublishDraft,
  type PublishDraft,
} from '../publish-draft'

const props = defineProps<{ initialMode: PostMode }>()
const emit = defineEmits<{ toast: [message: string]; published: [] }>()
const store = useCommunityStore()
type PublishField = 'title' | 'content' | 'category' | 'timeWindow' | 'duration' | 'specialNote' | 'eventStartsAt' | 'eventCapacity' | 'location' | 'syntheticConfirm'
type PublishFieldErrors = Partial<Record<PublishField, string>>

const PUBLISH_FIELD_IDS: Record<PublishField, string> = {
  title: 'publish-title',
  content: 'publish-content',
  category: 'publish-category',
  timeWindow: 'publish-time-window',
  duration: 'publish-duration',
  specialNote: 'publish-special-note',
  eventStartsAt: 'publish-event-start',
  eventCapacity: 'publish-event-capacity',
  location: 'publish-location',
  syntheticConfirm: 'publish-synthetic-confirm',
}
const PUBLISH_FIELD_ORDER: PublishField[] = [
  'title', 'content', 'category', 'timeWindow', 'duration', 'specialNote',
  'eventStartsAt', 'eventCapacity', 'location', 'syntheticConfirm',
]
const formError = ref('')
const fieldErrors = ref<PublishFieldErrors>({})
const globalErrors = ref<string[]>([])
const confirmedSynthetic = ref(false)
const draftStatus = ref<'idle' | 'restored' | 'saved' | 'storage-error'>('idle')
let draftTimer: number | undefined
const form = reactive({
  mode: props.initialMode as PostMode,
  title: '', content: '', location: '演练社区（虚构）',
  category: '待分类', timeWindow: '', duration: '', specialNote: '',
  volunteerKind: 'update' as 'update' | 'activity', eventStartsAt: '', eventCapacity: '',
  anonymous: false, publishedToFeed: true,
})
watch(() => props.initialMode, (value) => { form.mode = value; clearValidationErrors() })
watch(() => [form.mode, form.volunteerKind] as const, () => clearValidationErrors())

function hasDraftContent() {
  return Boolean(form.title.trim() || form.content.trim())
}

function draftPayload(): PublishDraft {
  return {
    mode: form.mode,
    title: form.title,
    content: form.content,
    location: form.location,
    category: form.category,
    timeWindow: form.timeWindow,
    duration: form.duration,
    specialNote: form.specialNote,
    volunteerKind: form.volunteerKind,
    eventStartsAt: form.eventStartsAt,
    eventCapacity: form.eventCapacity,
    anonymous: form.anonymous,
    publishedToFeed: form.publishedToFeed,
  }
}

function saveDraftNow() {
  if (!hasDraftContent()) {
    clearDraft()
    return
  }
  draftStatus.value = writePublishDraft(draftPayload()) ? 'saved' : 'storage-error'
}

function scheduleDraftSave() {
  if (typeof window === 'undefined') return
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(saveDraftNow, 400)
}

function clearDraft() {
  clearPublishDraft()
  draftStatus.value = 'idle'
}

function refreshFormError() {
  const fieldCount = Object.keys(fieldErrors.value).length
  const fieldSummary = fieldCount ? `请修正标有错误的字段（${fieldCount} 项）后重新提交。` : ''
  formError.value = [globalErrors.value.join(' '), fieldSummary].filter(Boolean).join(' ')
}

function clearValidationErrors() {
  fieldErrors.value = {}
  globalErrors.value = []
  formError.value = ''
}

function clearFieldError(field: PublishField) {
  if (!fieldErrors.value[field]) return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
  refreshFormError()
}

function fieldErrorId(field: PublishField) {
  return `${PUBLISH_FIELD_IDS[field]}-error`
}

function describedBy(field: PublishField, ...extraIds: string[]) {
  const ids = [...extraIds]
  if (fieldErrors.value[field]) ids.push(fieldErrorId(field))
  return ids.length ? ids.join(' ') : undefined
}

function validatePublishForm(): PublishFieldErrors {
  const errors: PublishFieldErrors = {}
  const title = form.title.trim()
  const content = form.content.trim()
  if (!title) errors.title = '请填写标题。'
  else if (title.length > 120) errors.title = '标题不能超过 120 个字符。'
  if (!content) errors.content = '请填写正文。'
  else if (content.length > 2_000) errors.content = '正文不能超过 2000 个字符。'
  if (form.location.trim().length > 120) errors.location = '地点不能超过 120 个字符。'

  if (form.mode === 'help') {
    const category = form.category.trim()
    const timeWindow = form.timeWindow.trim()
    const duration = form.duration.trim()
    const specialNote = form.specialNote.trim()
    if (!category) errors.category = '请填写服务分类；尚未分类时可填写“待分类”。'
    else if (category.length > 240) errors.category = '服务分类不能超过 240 个字符。'
    if (!timeWindow) errors.timeWindow = '请填写希望时段。'
    else if (timeWindow.length > 240) errors.timeWindow = '希望时段不能超过 240 个字符。'
    if (!duration) errors.duration = '请填写预计时长。'
    else if (duration.length > 240) errors.duration = '预计时长不能超过 240 个字符。'
    if (specialNote.length > 240) errors.specialNote = '补充说明不能超过 240 个字符。'
  }

  if (form.mode === 'volunteer' && form.volunteerKind === 'activity') {
    const startTimestamp = Date.parse(form.eventStartsAt)
    if (!form.eventStartsAt || Number.isNaN(startTimestamp)) {
      errors.eventStartsAt = '请输入有效的活动开始时间。'
    }
    const capacityText = String(form.eventCapacity ?? '').trim()
    if (capacityText) {
      const capacity = Number(capacityText)
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
        errors.eventCapacity = '活动名额须为 1 至 200 的整数。'
      }
    }
  }
  if (!confirmedSynthetic.value) errors.syntheticConfirm = '请先确认这是虚构的演练内容。'
  return errors
}

function mapStoreErrors(messages: readonly string[]): { fields: PublishFieldErrors; global: string[] } {
  const fields: PublishFieldErrors = {}
  const global: string[] = []
  const addField = (field: PublishField, message: string) => { fields[field] ??= message }

  for (const message of messages) {
    if (message.includes('标题')) { addField('title', message); continue }
    if (message.includes('正文')) { addField('content', message); continue }
    if (message.includes('地点')) { addField('location', message); continue }
    if (message.includes('分类、时段、时长和补充说明')) {
      let mapped = false
      if (form.mode === 'help') {
        if (form.category.trim().length > 240) { addField('category', '服务分类不能超过 240 个字符。'); mapped = true }
        if (form.timeWindow.trim().length > 240) { addField('timeWindow', '希望时段不能超过 240 个字符。'); mapped = true }
        if (form.duration.trim().length > 240) { addField('duration', '预计时长不能超过 240 个字符。'); mapped = true }
        if (form.specialNote.trim().length > 240) { addField('specialNote', '补充说明不能超过 240 个字符。'); mapped = true }
      }
      if (!mapped) global.push(message)
      continue
    }
    if (message.includes('求助登记请补充服务分类')) {
      let mapped = false
      if (!form.category.trim()) { addField('category', '请填写服务分类；尚未分类时可填写“待分类”。'); mapped = true }
      if (!form.timeWindow.trim()) { addField('timeWindow', '请填写希望时段。'); mapped = true }
      if (!form.duration.trim()) { addField('duration', '请填写预计时长。'); mapped = true }
      if (!mapped) global.push(message)
      continue
    }
    if (message.includes('活动名额') && form.mode === 'volunteer' && form.volunteerKind === 'activity') {
      addField('eventCapacity', message)
      continue
    }
    if (message.includes('开始时间') && form.mode === 'volunteer' && form.volunteerKind === 'activity') {
      addField('eventStartsAt', message)
      continue
    }
    global.push(message)
  }
  return { fields, global }
}

async function showValidationErrors(errors: PublishFieldErrors, general: string[] = []) {
  fieldErrors.value = errors
  globalErrors.value = general
  refreshFormError()
  await nextTick()
  const firstField = PUBLISH_FIELD_ORDER.find((field) =>
    Boolean(fieldErrors.value[field] && document.getElementById(PUBLISH_FIELD_IDS[field])))
  if (firstField) {
    document.getElementById(PUBLISH_FIELD_IDS[firstField])?.focus()
  } else if (formError.value) {
    document.getElementById('publish-form-error')?.focus()
  }
}

function discardDraft() {
  form.title = ''
  form.content = ''
  form.timeWindow = ''
  form.duration = ''
  form.specialNote = ''
  form.eventStartsAt = ''
  form.eventCapacity = ''
  form.anonymous = false
  form.publishedToFeed = true
  confirmedSynthetic.value = false
  clearDraft()
  clearValidationErrors()
  emit('toast', '已清除本机发布草稿。')
}

watch(form, scheduleDraftSave, { deep: true })

onMounted(() => {
  const draft = readPublishDraft()
  if (!draft) return
  Object.assign(form, draft)
  draftStatus.value = 'restored'
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.clearTimeout(draftTimer)
  saveDraftNow()
})

async function submit() {
  clearValidationErrors()
  const localErrors = validatePublishForm()
  if (Object.keys(localErrors).length > 0) {
    await showValidationErrors(localErrors)
    return
  }

  const eventStartTimestamp = form.mode === 'volunteer' && form.volunteerKind === 'activity'
    ? Date.parse(form.eventStartsAt)
    : Number.NaN
  const base = { mode: form.mode, title: form.title, content: form.content, location: form.location }
  const result = form.mode === 'help'
    ? store.publishPost({ ...base, category: form.category, timeWindow: form.timeWindow, duration: form.duration, specialNote: form.specialNote })
    : form.mode === 'volunteer'
      ? store.publishPost({
          ...base,
          volunteerKind: form.volunteerKind,
          anonymous: form.anonymous,
          publishedToFeed: form.publishedToFeed,
          ...(form.volunteerKind === 'activity' ? {
            eventStartsAt: new Date(eventStartTimestamp).toISOString(),
            ...(form.eventCapacity ? { eventCapacity: Number(form.eventCapacity) } : {}),
          } : {}),
        })
      : store.publishPost(base)
  if (!result.ok) {
    const mapped = mapStoreErrors(result.errors)
    await showValidationErrors(mapped.fields, mapped.global)
    return
  }
  emit('toast', '已提交本机待审队列；审核通过后才会展示。可在我的发布查看状态。')
  form.title = ''; form.content = ''; form.timeWindow = ''; form.duration = ''; form.specialNote = ''
  form.eventStartsAt = ''; form.eventCapacity = ''; form.anonymous = false; form.publishedToFeed = true
  confirmedSynthetic.value = false
  clearDraft()
  emit('published')
}
</script>

<template>
  <div class="page-stack publish-page">
    <section class="publish-heading"><span class="soft-label">SHARE WITH YOUR NEIGHBORS</span><h1>发布一件小事。</h1><p>这里先做通用登记；服务分类保持待定，后续由运营方确认。</p></section>
    <div class="publish-layout">
      <form class="publish-form" novalidate @submit.prevent="submit">
        <fieldset class="mode-picker"><legend>选择发布类型</legend><div class="mode-options">
          <button type="button" :class="{ selected: form.mode === 'help' }" @click="form.mode = 'help'"><span aria-hidden="true">↗</span><strong>求助登记</strong><small>通用需求</small></button>
          <button type="button" :class="{ selected: form.mode === 'volunteer' }" @click="form.mode = 'volunteer'"><span aria-hidden="true">✳</span><strong>志愿发布</strong><small>日记 / 活动</small></button>
          <button type="button" :class="{ selected: form.mode === 'neighbor' }" @click="form.mode = 'neighbor'"><span aria-hidden="true">⌂</span><strong>邻里分享</strong><small>日常信息</small></button>
        </div></fieldset>

        <div v-if="form.mode === 'volunteer'" class="submode-row"><span>内容类型</span><div><button type="button" :class="{ active: form.volunteerKind === 'update' }" @click="form.volunteerKind = 'update'">志愿记录</button><button type="button" :class="{ active: form.volunteerKind === 'activity' }" @click="form.volunteerKind = 'activity'">活动招募</button></div></div>

        <label for="publish-title" class="field-label">标题 <span>*</span><input id="publish-title" v-model="form.title" maxlength="120" required placeholder="用一句话说清楚" :aria-invalid="fieldErrors.title ? 'true' : undefined" :aria-describedby="describedBy('title')" @input="clearFieldError('title')" /><small v-if="fieldErrors.title" :id="fieldErrorId('title')" class="field-error">{{ fieldErrors.title }}</small></label>
        <label for="publish-content" class="field-label">{{ form.mode === 'help' ? '需求说明' : form.mode === 'volunteer' ? (form.volunteerKind === 'activity' ? '活动介绍' : '志愿内容') : '分享内容' }} <span>*</span><textarea id="publish-content" v-model="form.content" maxlength="2000" required rows="5" placeholder="补充背景、地点或参与方式。请勿填写真实个人信息。" :aria-invalid="fieldErrors.content ? 'true' : undefined" :aria-describedby="describedBy('content', 'publish-content-count')" @input="clearFieldError('content')"></textarea><small id="publish-content-count">{{ form.content.length }} / 2000</small><small v-if="fieldErrors.content" :id="fieldErrorId('content')" class="field-error">{{ fieldErrors.content }}</small></label>

        <div v-if="form.mode === 'help'" class="form-section"><div class="form-section-title"><strong>通用服务登记</strong><small>服务类别暂不细分</small></div><div class="two-fields"><label for="publish-category" class="field-label">服务分类<input id="publish-category" v-model="form.category" maxlength="240" required :aria-invalid="fieldErrors.category ? 'true' : undefined" :aria-describedby="describedBy('category')" @input="clearFieldError('category')" /><small v-if="fieldErrors.category" :id="fieldErrorId('category')" class="field-error">{{ fieldErrors.category }}</small></label><label for="publish-time-window" class="field-label">希望时段 <span>*</span><input id="publish-time-window" v-model="form.timeWindow" maxlength="240" required placeholder="例如：周四下午" :aria-invalid="fieldErrors.timeWindow ? 'true' : undefined" :aria-describedby="describedBy('timeWindow')" @input="clearFieldError('timeWindow')" /><small v-if="fieldErrors.timeWindow" :id="fieldErrorId('timeWindow')" class="field-error">{{ fieldErrors.timeWindow }}</small></label></div><label for="publish-duration" class="field-label">预计时长 <span>*</span><input id="publish-duration" v-model="form.duration" maxlength="240" required placeholder="例如：约 1 小时" :aria-invalid="fieldErrors.duration ? 'true' : undefined" :aria-describedby="describedBy('duration')" @input="clearFieldError('duration')" /><small v-if="fieldErrors.duration" :id="fieldErrorId('duration')" class="field-error">{{ fieldErrors.duration }}</small></label><label for="publish-special-note" class="field-label">补充说明<textarea id="publish-special-note" v-model="form.specialNote" maxlength="240" rows="2" placeholder="可选；不要写真实姓名、电话或住址" :aria-invalid="fieldErrors.specialNote ? 'true' : undefined" :aria-describedby="describedBy('specialNote')" @input="clearFieldError('specialNote')"></textarea><small v-if="fieldErrors.specialNote" :id="fieldErrorId('specialNote')" class="field-error">{{ fieldErrors.specialNote }}</small></label></div>

        <div v-if="form.mode === 'volunteer' && form.volunteerKind === 'activity'" class="form-section"><div class="form-section-title"><strong>活动信息</strong><small>仅用于报名流程演示</small></div><div class="two-fields"><label for="publish-event-start" class="field-label">活动开始时间 <span>*</span><input id="publish-event-start" v-model="form.eventStartsAt" type="datetime-local" required :aria-invalid="fieldErrors.eventStartsAt ? 'true' : undefined" :aria-describedby="describedBy('eventStartsAt')" @input="clearFieldError('eventStartsAt')" /><small v-if="fieldErrors.eventStartsAt" :id="fieldErrorId('eventStartsAt')" class="field-error">{{ fieldErrors.eventStartsAt }}</small></label><label for="publish-event-capacity" class="field-label">名额上限<input id="publish-event-capacity" v-model="form.eventCapacity" type="number" min="1" max="200" placeholder="不限名额" :aria-invalid="fieldErrors.eventCapacity ? 'true' : undefined" :aria-describedby="describedBy('eventCapacity')" @input="clearFieldError('eventCapacity')" /><small v-if="fieldErrors.eventCapacity" :id="fieldErrorId('eventCapacity')" class="field-error">{{ fieldErrors.eventCapacity }}</small></label></div></div>

        <label for="publish-location" class="field-label">演练地点<input id="publish-location" v-model="form.location" maxlength="120" placeholder="演练社区（虚构）" :aria-invalid="fieldErrors.location ? 'true' : undefined" :aria-describedby="describedBy('location')" @input="clearFieldError('location')" /><small v-if="fieldErrors.location" :id="fieldErrorId('location')" class="field-error">{{ fieldErrors.location }}</small></label>

        <div v-if="form.mode === 'volunteer'" class="toggle-list"><label><span><strong>匿名显示</strong><small>动态中不显示演练用户名</small></span><input v-model="form.anonymous" type="checkbox" class="switch-input" role="switch" :aria-checked="form.anonymous" /><i class="switch"></i></label><label><span><strong>公开到社区动态</strong><small>关闭后只在“我的发布”中可见</small></span><input v-model="form.publishedToFeed" type="checkbox" class="switch-input" role="switch" :aria-checked="form.publishedToFeed" /><i class="switch"></i></label></div>

        <div v-if="draftStatus !== 'idle'" class="draft-hint" role="status"><span>{{ draftStatus === 'restored' ? '已恢复上次未提交的本机草稿（仅当前浏览器，仍需重新确认虚构内容）。' : draftStatus === 'saved' ? '草稿已自动保存在本机；提交前仍需勾选虚构内容确认。' : '当前浏览器无法保存草稿，本次内容只在页面会话中保留。' }}</span><button type="button" class="text-link" @click="discardDraft">清除草稿</button></div>
        <label class="confirm-synthetic"><input id="publish-synthetic-confirm" v-model="confirmedSynthetic" type="checkbox" required aria-required="true" :aria-invalid="fieldErrors.syntheticConfirm ? 'true' : undefined" :aria-describedby="describedBy('syntheticConfirm')" @change="clearFieldError('syntheticConfirm')" /><span>我确认以上全部是虚构演练内容，不包含真实居民信息。</span></label>
        <small v-if="fieldErrors.syntheticConfirm" :id="fieldErrorId('syntheticConfirm')" class="field-error">{{ fieldErrors.syntheticConfirm }}</small>
        <p v-if="formError" id="publish-form-error" class="form-error" role="alert" tabindex="-1">{{ formError }}</p>
        <button class="button-primary submit-button" type="submit">提交审核 <span>↗</span></button>
        <p class="form-privacy">所有发布先审后发，审核通过且选择公开后才进入社区信息流。内容仅保存在此浏览器；不会发布到真实社区、发送消息或产生真实服务记录。</p>
      </form>
      <aside class="publish-aside"><div class="aside-art"><span class="aside-star">✳</span><div class="aside-orbit"></div><div class="aside-hands">⌂</div><span class="aside-caption">small things<br />make a community</span></div><div class="aside-copy"><span class="soft-label">A NOTE BEFORE YOU POST</span><h3>好的互助，<br />从清楚表达开始。</h3><ul><li><span>01</span>说清楚需要什么帮助</li><li><span>02</span>写下可行的时间范围</li><li><span>03</span>地点和身份都用虚构内容</li></ul><div class="aside-demo-label"><i></i> 本地演示 · 无外部发送</div></div></aside>
    </div>
  </div>
</template>
