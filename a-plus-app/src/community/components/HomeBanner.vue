<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BANNER_INTERVAL_MS,
  BANNER_SWIPE_THRESHOLD,
  bannerSlideLabel,
  bannerSlides,
  clampIndex,
  resolveInitialAutoPlay,
  rotationAllowed,
  rotationControlLabel,
  stepIndex,
  swipeDirection,
  type BannerAction,
} from '../banner-slides'

/**
 * 首页社区公告轮播。
 *
 * 无障碍口径以 W3C APG Carousel 模式为准：
 * - 容器 role=region + aria-roledescription=carousel，标题作可访问名称；
 * - 幻灯片 role=tabpanel + aria-roledescription=slide，圆点用 tablist 选择；
 * - 自动轮播时 aria-live=off，停止后改为 polite；
 * - 焦点或手动切换即停止，且不自动恢复，只有点“播放”才继续；
 * - 悬停暂停、页面隐藏暂停、系统“减少动态效果”时默认不自动播放。
 *
 * 为什么不引第三方轮播库：本项目离线交付、禁止新增依赖，且只需要单张淡入淡出；
 * 自实现可把焦点、实时区与暂停条件集中在一个组件内，体积与可测性更可控。
 */
const emit = defineEmits<{ action: [BannerAction, MouseEvent] }>()

const slides = bannerSlides
const root = ref<HTMLElement | null>(null)
const total = slides.length
const activeIndex = ref(0)
const autoRotate = ref(resolveInitialAutoPlay(prefersReducedMotion()))
const hovering = ref(false)
const pageHidden = ref(typeof document !== 'undefined' && document.visibilityState === 'hidden')

const rotating = computed(() => rotationAllowed({
  autoRotate: autoRotate.value,
  hovering: hovering.value,
  pageHidden: pageHidden.value,
}))
const activeSlide = computed(() => slides[clampIndex(activeIndex.value, total)])
const liveMode = computed(() => (rotating.value ? 'off' : 'polite'))
const controlLabel = computed(() => rotationControlLabel(autoRotate.value))
const counter = computed(() => ({
  current: String(activeIndex.value + 1).padStart(2, '0'),
  total: String(total).padStart(2, '0'),
}))

let timer: number | null = null
let mediaQuery: MediaQueryList | null = null
let swipeResetTimer: number | null = null
let pointerIntentUntil = 0
let activePointer: number | null = null
let captured = false
let startX = 0
let startY = 0
let swiped = false

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function stopTimer() {
  if (timer === null) return
  window.clearInterval(timer)
  timer = null
}

function startTimer() {
  stopTimer()
  timer = window.setInterval(() => {
    activeIndex.value = stepIndex(activeIndex.value, 1, total)
  }, BANNER_INTERVAL_MS)
}

watch(rotating, (allowed) => {
  if (allowed) startTimer()
  else stopTimer()
}, { immediate: true })

/**
 * 手动切换即视为接管：停止自动播放，实时区恢复播报。
 * 若焦点原本在幻灯片里的按钮上，切换会把该幻灯片设为 inert 并导致焦点掉到 body，
 * 因此把焦点交给新幻灯片的主操作，键盘可以继续用方向键或 Tab。
 */
function goTo(index: number) {
  const focusWasInsideSlide = Boolean((document.activeElement as HTMLElement | null)?.closest?.('.banner-slide'))
  activeIndex.value = clampIndex(index, total)
  autoRotate.value = false
  if (!focusWasInsideSlide) return
  void nextTick(() => {
    const next = root.value?.querySelector<HTMLElement>('.banner-slide.is-active .banner-cta')
    ;(next ?? root.value)?.focus()
  })
}

function step(delta: number) {
  goTo(activeIndex.value + delta)
}

function toggleRotation() {
  autoRotate.value = !autoRotate.value
}

/**
 * 鼠标点击按钮会先触发 focusin，再触发 click。
 * 若在 focusin 里停播，暂停按钮的点击会被自己“先停后开”，语义反转。
 * 用指针意图标记跳过这次 focusin；键盘 Tab 进来仍会停播。
 */
function onFocusIn() {
  // 800ms 只覆盖一次 pointerdown→focusin 的时序；即使指针在容器外释放也不会卡住。
  if (performance.now() < pointerIntentUntil) return
  autoRotate.value = false
}

function onPointerDownCapture() {
  pointerIntentUntil = performance.now() + 800
}

function resetPointerIntent() {
  pointerIntentUntil = 0
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  activePointer = event.pointerId
  startX = event.clientX
  startY = event.clientY
  swiped = false
  captured = false
}

/**
 * 只在确认横向拖动后才捕获指针。
 * 若在 pointerdown 就捕获，浏览器会把后续 click 目标重定向到视口，
 * 幻灯片里的 CTA 会变成点不动（已用真实鼠标事件复现）。
 */
function onPointerMove(event: PointerEvent) {
  if (activePointer !== event.pointerId || captured) return
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  if (Math.abs(deltaX) < BANNER_SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return
  try {
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
    captured = true
  } catch {
    /* 旧浏览器或已释放的指针：仍可完成本次滑动 */
  }
}

function onPointerUp(event: PointerEvent) {
  if (activePointer !== event.pointerId) return
  activePointer = null
  captured = false
  const direction = swipeDirection(event.clientX - startX, event.clientY - startY)
  if (direction === 0) return
  swiped = true
  step(direction)
  if (swipeResetTimer !== null) window.clearTimeout(swipeResetTimer)
  // 滑动结束后浏览器仍会派发 click；短暂标记以拦掉这次误点。
  swipeResetTimer = window.setTimeout(() => { swiped = false }, 400)
}

function onPointerCancel() {
  activePointer = null
  captured = false
  swiped = false
}

function onClickCapture(event: MouseEvent) {
  if (!swiped) return
  swiped = false
  event.preventDefault()
  event.stopPropagation()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const target = event.target as HTMLElement | null
  // 圆点用 Tabs 模式，方向键交给 v-tablist，避免一次按键切两张。
  if (target?.closest?.('[role="tab"]')) return
  event.preventDefault()
  step(event.key === 'ArrowRight' ? 1 : -1)
}

function onMotionPreference(event: MediaQueryListEvent) {
  if (event.matches) autoRotate.value = false
}

function onVisibilityChange() {
  pageHidden.value = document.visibilityState === 'hidden'
}

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', onMotionPreference)
    else mediaQuery.addListener?.(onMotionPreference)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopTimer()
  if (swipeResetTimer !== null) window.clearTimeout(swipeResetTimer)
  if (mediaQuery) {
    if (typeof mediaQuery.removeEventListener === 'function') mediaQuery.removeEventListener('change', onMotionPreference)
    else mediaQuery.removeListener?.(onMotionPreference)
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <section
    ref="root"
    class="home-banner"
    tabindex="-1"
    :class="`tone-${activeSlide.tone}`"
    role="region"
    aria-roledescription="carousel"
    aria-labelledby="home-banner-title"
    :data-active-slide="activeSlide.id"
    :data-rotating="rotating ? 'true' : 'false'"
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @pointerdown.capture="onPointerDownCapture"
    @pointerup="resetPointerIntent"
    @pointercancel="resetPointerIntent"
  >
    <div class="banner-head">
      <span id="home-banner-title" class="banner-kicker">邻里公告板<span class="banner-kicker-note"> · 本机演练</span></span>
      <div class="banner-tools">
        <button class="banner-tool banner-play" type="button" :aria-label="controlLabel" @click="toggleRotation">
          <svg v-if="autoRotate" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="3" y="2" width="3.4" height="12" rx="1.2" fill="currentColor" /><rect x="9.6" y="2" width="3.4" height="12" rx="1.2" fill="currentColor" /></svg>
          <svg v-else viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4.4 2.3 13 8l-8.6 5.7z" fill="currentColor" /></svg>
          <span class="banner-tool-text">{{ autoRotate ? '暂停' : '播放' }}</span>
        </button>
        <button class="banner-tool" type="button" aria-label="上一张公告" @click="step(-1)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M10.2 2.4 3.6 8l6.6 5.6z" fill="currentColor" /></svg>
        </button>
        <button class="banner-tool" type="button" aria-label="下一张公告" @click="step(1)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5.8 2.4 12.4 8l-6.6 5.6z" fill="currentColor" /></svg>
        </button>
      </div>
    </div>

    <div
      class="banner-viewport"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @click.capture="onClickCapture"
    >
      <div class="banner-track" :aria-live="liveMode" aria-atomic="false">
        <article
          v-for="(slide, index) in slides"
          :id="`home-banner-slide-${slide.id}`"
          :key="slide.id"
          class="banner-slide"
          :class="{ 'is-active': index === activeIndex }"
          role="tabpanel"
          aria-roledescription="slide"
          :aria-label="bannerSlideLabel(index, total)"
          :aria-hidden="index !== activeIndex"
          :inert="index !== activeIndex ? true : undefined"
        >
          <h2 class="banner-title">{{ slide.title }}</h2>
          <p class="banner-summary">{{ slide.summary }}</p>
          <div class="banner-slide-foot">
            <span class="banner-meta">{{ slide.meta }}</span>
            <button class="banner-cta" type="button" @click="emit('action', slide.action, $event)">
              {{ slide.action.label }} <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>
      </div>
    </div>

    <div class="banner-foot">
      <span class="banner-count" aria-hidden="true">{{ counter.current }} <i>/</i> {{ counter.total }}</span>
      <div v-tablist class="banner-dots" role="tablist" aria-label="选择公告">
        <button
          v-for="(slide, index) in slides"
          :id="`home-banner-tab-${slide.id}`"
          :key="slide.id"
          class="banner-dot"
          type="button"
          role="tab"
          :aria-controls="`home-banner-slide-${slide.id}`"
          :aria-selected="index === activeIndex"
          :tabindex="index === activeIndex ? 0 : -1"
          :aria-label="`${index + 1}、${slide.kicker}：${slide.title}`"
          @click="goTo(index)"
        >
          <span aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </section>
</template>
