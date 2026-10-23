// Local-only queue filter preference for the A+ intake workspace.

export const INTAKE_FILTERS = [
  '全部记录',
  '待处理',
  '待分诊',
  '初筛中',
  '演练逾期',
  '高风险',
  '已结束',
] as const

export type IntakeFilter = (typeof INTAKE_FILTERS)[number]

export const INTAKE_FILTER_KEY = 'a-plus.intake-filter.v1'
export const DEFAULT_INTAKE_FILTER: IntakeFilter = '全部记录'

export function isIntakeFilter(value: unknown): value is IntakeFilter {
  return typeof value === 'string' && (INTAKE_FILTERS as readonly string[]).includes(value)
}

export function readIntakeFilter(): IntakeFilter {
  try {
    const raw = window.localStorage.getItem(INTAKE_FILTER_KEY)
    return isIntakeFilter(raw) ? raw : DEFAULT_INTAKE_FILTER
  } catch {
    return DEFAULT_INTAKE_FILTER
  }
}

export function writeIntakeFilter(value: IntakeFilter): void {
  try {
    window.localStorage.setItem(INTAKE_FILTER_KEY, value)
  } catch {
    // Preference storage failure must never block intake work.
  }
}
