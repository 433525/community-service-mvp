/**
 * A+ 登记队列的展示层辅助：把领域状态翻译成界面文案。
 *
 * 这里只允许出现纯函数与常量，不得访问 store、DOM 或浏览器存储，
 * 以便单元测试直接覆盖，也避免子组件反向依赖工作台状态。
 */
import type {
  DemoRole,
  IntakeAction,
  IntakeCase,
  IntakeEvent,
  IntakeReasonCode,
} from '../domain/intake'
import { INTAKE_REASON_CODES } from '../domain/intake'
import type { CommunityHelpPost } from '../domain/community-bridge'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../community/types'

export interface DemoRoleOption {
  value: DemoRole
  label: string
}

/** 三个演示角色只用于展示分工，不是登录或权限。 */
export const DEMO_ROLES: readonly DemoRoleOption[] = [
  { value: 'demo-intake', label: '演示 · 受理席' },
  { value: 'demo-review', label: '演示 · 复核席' },
  { value: 'demo-referral', label: '演示 · 转介席' },
]

export function roleLabel(role: DemoRole | null | undefined): string {
  return DEMO_ROLES.find((item) => item.value === role)?.label ?? '未记录'
}

export const REASON_LABELS: Record<IntakeReasonCode, string> = {
  INFO_INSUFFICIENT: '信息不足',
  OUT_OF_SCOPE: '超出登记范围',
  DUPLICATE: '重复登记',
  REQUESTER_WITHDREW: '请求方撤回',
  NO_SERVICE_PATH: '暂无可行服务路径',
  INFORMATION_PROVIDED: '已提供信息',
  REFERRAL_DECLINED: '转介未获接收',
  FOLLOW_UP_CONCLUDED: '人工跟进结束（结果未核实）',
  OTHER: '其他（需写明）',
}

export const ACTION_LABELS: Record<IntakeAction, string> = {
  BEGIN_SCREENING: '开始初筛',
  REQUEST_INFORMATION: '标记待补充',
  RESUME_SCREENING: '恢复初筛',
  ACCEPT_FOR_TRIAGE: '进入待分诊',
  REFER: '登记转介',
  CONFIRM_REFERRAL: '录入演练接收确认',
  REFERRAL_FAILED: '记录转介失败，返回待分诊',
  RECORD_HIGH_RISK_HANDOFF: '记录演练人工交接结果',
  REJECT: '记录拒绝',
  WITHDRAW: '记录撤回',
  CLOSE_WITHOUT_SERVICE: '关闭（未提供服务）',
  CLOSE_FOLLOW_UP: '结束人工跟进（服务结果未核实）',
  PROVIDE_INFORMATION: '记录已提供信息',
}

export function communityOrderStatusLabel(status: CommunityHelpPost['orderStatus']): string {
  return ORDER_STATUS_LABELS[status as OrderStatus]
}

/** 默认截止日期：两天后的 17:00，仅用于演练。 */
export function defaultDueDate(): string {
  const value = new Date()
  value.setDate(value.getDate() + 2)
  value.setHours(17, 0, 0, 0)
  return toLocalInput(value.toISOString())
}

/** ISO 时间 → `datetime-local` 输入框可识别的本地时间串。 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间无效'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

/** 高风险停止标记会锁定常规初筛，是全界面最高优先级的展示状态。 */
export function caseHasHighRisk(item: IntakeCase): boolean {
  return item.riskFlags.some((flag) => flag.code === 'HIGH_RISK_STOP_SCREENING')
}

export function caseStatusLabel(item: IntakeCase): string {
  if (caseHasHighRisk(item)) return `${item.status} · 已停止常规初筛 · 风险未解除`
  if (item.status === '已转介已接收') return '已转介 · 演练确认已录入'
  return item.status
}

export function eventHeading(event: IntakeEvent): string {
  if (event.action) return ACTION_LABELS[event.action]
  if (event.kind === 'created') return '创建演练记录'
  if (event.kind === 'follow-up-update') return '调整人工跟进'
  if (event.kind === 'contact-simulation') return '模拟联系结果'
  if (event.kind === 'case-link') return '关联重开演练记录'
  if (event.kind === 'duplicate-review') return '人工重复登记复核'
  if (event.kind === 'checkpoint-update') return '更新登记检查点'
  if (event.kind === 'risk-flag') return '添加风险演练标记'
  if (event.kind === 'timeout') return '标记内部演练待办超时'
  return '登记状态更新'
}

export function eventChangeValue(field: 'owner' | 'nextStep' | 'dueAt', value: string | null): string {
  if (field === 'dueAt') return formatDate(value)
  return value || '未设置'
}

/** 状态流转对话框除“结束人工跟进”外都允许选择全部原因码。 */
export function transitionReasonOptions(action: IntakeAction | null): IntakeReasonCode[] {
  return action === 'CLOSE_FOLLOW_UP' ? ['FOLLOW_UP_CONCLUDED'] : [...INTAKE_REASON_CODES]
}
