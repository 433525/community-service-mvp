import type { PostMode } from './types'

/**
 * 首页公告轮播的静态数据与纯逻辑。
 *
 * 内容全部为虚构演练公告，不包含真实地址、电话或机构承诺；
 * 这里不做网络请求，也不读本机存档，避免首屏被数据状态拖慢。
 */
export type BannerTone = 'green' | 'sand' | 'clay' | 'blue'

export type BannerAction =
  | { kind: 'community'; label: string }
  | { kind: 'profile'; label: string }
  | { kind: 'safety'; label: string }
  | { kind: 'publish'; label: string; mode: PostMode }
  | { kind: 'search'; label: string; filter: 'all' | PostMode }

export interface BannerSlide {
  readonly id: string
  readonly kicker: string
  readonly title: string
  readonly summary: string
  readonly meta: string
  readonly tone: BannerTone
  readonly action: BannerAction
}

/** 自动轮播间隔：与 APG 示例的 5–8 秒区间一致，留给阅读但不至于等太久。 */
export const BANNER_INTERVAL_MS = 7000

/** 指针滑动阈值：短于该距离视为点击，避免误切。 */
export const BANNER_SWIPE_THRESHOLD = 40

export const bannerSlides: readonly BannerSlide[] = [
  {
    id: 'notice',
    kicker: '社区公告',
    title: '本周六，邻里议事会在活动室',
    summary: '10 月 25 日 9:30 在社区活动室，仅作界面演示。',
    meta: '社区公告 · 10 月 25 日',
    tone: 'green',
    action: { kind: 'community', label: '查看社区动态' },
  },
  {
    id: 'time-bank',
    kicker: '时间银行规则',
    title: '1 小时服务，记 1 个时间币',
    summary: '本机演练只记录时长，不可兑换、结算或提现。',
    meta: '时间银行规则 · 不结算',
    tone: 'sand',
    action: { kind: 'profile', label: '查看时间账本' },
  },
  {
    id: 'recruit',
    kicker: '志愿活动招募',
    title: '独居老人陪伴走访，招募 8 人',
    summary: '10 月 26 日下午集合，报名与人数均为合成数据。',
    meta: '志愿活动招募 · 8 人',
    tone: 'clay',
    action: { kind: 'search', label: '查看志愿活动', filter: 'volunteer' },
  },
  {
    id: 'elder-care',
    kicker: '养老科普',
    title: '秋冬居家防跌倒，先做三件事',
    summary: '清理走道杂物、夜间留灯、常用物品放在腰部高度。',
    meta: '养老科普 · 非医疗建议',
    tone: 'blue',
    action: { kind: 'search', label: '查看邻里分享', filter: 'neighbor' },
  },
  {
    id: 'safety',
    kicker: '独居老人安全注意',
    title: '在门口留一张紧急联系人卡',
    summary: '写上联系人、常用药与就医偏好，本原型不会呼叫任何人。',
    meta: '安全提示 · 非紧急通道',
    tone: 'green',
    action: { kind: 'safety', label: '查看安全说明' },
  },
]

/** 把任意下标收进 `0..length-1`；空列表固定返回 0，避免取不到标题。 */
export function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0
  const whole = Math.trunc(index)
  return ((whole % length) + length) % length
}

/** 环形前后移动；供自动轮播、前后按钮与键盘共用。 */
export function stepIndex(index: number, step: number, length: number): number {
  if (length <= 0) return 0
  return clampIndex(index + (Number.isFinite(step) ? Math.trunc(step) : 0), length)
}

/**
 * 指针位移 → 切换方向。
 * 返回 1 表示下一张（向左滑），-1 表示上一张；竖向意图或未达阈值返回 0。
 */
export function swipeDirection(
  deltaX: number,
  deltaY: number,
  threshold: number = BANNER_SWIPE_THRESHOLD,
): -1 | 0 | 1 {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return 0
  const limit = Math.max(1, threshold)
  if (Math.abs(deltaY) > Math.abs(deltaX)) return 0
  if (Math.abs(deltaX) < limit) return 0
  return deltaX < 0 ? 1 : -1
}

/** 无显式偏好时是否自动播放：系统开启“减少动态效果”就不自动播放。 */
export function resolveInitialAutoPlay(reducedMotion: boolean): boolean {
  return !reducedMotion
}

export interface RotationInputs {
  /** 用户是否明确开启自动播放（点“暂停”后为 false）。 */
  autoRotate: boolean
  /** 指针悬停时暂停，移出后按 autoRotate 恢复。 */
  hovering: boolean
  /** 页面切到后台时不必继续计时。 */
  pageHidden: boolean
}

/**
 * 是否应当继续自动轮播。
 *
 * 口径按 W3C APG Carousel 模式：焦点或手动切换进入后停止，且不自动恢复；
 * 开源实现（如 embla-carousel-autoplay）默认会在失焦后恢复，
 * 这里以 APG 文档为准，避免键盘用户读到一半被切走。
 * 这里只保留“临时暂停”条件，永久停止由组件把 autoRotate 置为 false。
 */
export function rotationAllowed(inputs: RotationInputs): boolean {
  return inputs.autoRotate && !inputs.hovering && !inputs.pageHidden
}

/** 每张幻灯片的可访问名称；`role="group"/"tabpanel"` 不支持 aria-setsize，位置写进名称。 */
export function bannerSlideLabel(index: number, length: number): string {
  if (length <= 0) return '无公告'
  return `第 ${clampIndex(index, length) + 1} 张，共 ${length} 张`
}

/** 轮播控制按钮的可见/无障碍文案，随播放状态变化。 */
export function rotationControlLabel(allowed: boolean): string {
  return allowed ? '暂停自动播放' : '播放自动播放'
}
