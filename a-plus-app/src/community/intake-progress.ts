import { INTAKE_STORAGE_KEY, parseIntakeBackup } from '../domain/intake-backup'
import type { IntakeCase, IntakeEvent, IntakeStatus } from '../domain/intake'

export interface LocalIntakeProgress {
  readonly sourcePostId: string
  readonly status: IntakeStatus
  readonly updatedAt: string
  readonly latestEvent: Pick<IntakeEvent, 'kind' | 'at'> | null
}

export type IntakeProgressSnapshot =
  | { readonly state: 'ready'; readonly records: readonly LocalIntakeProgress[] }
  | { readonly state: 'missing' | 'unavailable'; readonly records: readonly [] }

export interface IntakeSourceLink {
  readonly sourcePostId: string
  readonly reopenedDepth: number
}

/** Resolve a reopened case back to its original community post without copying IDs. */
export function resolveIntakeSourceLink(
  intakeCase: IntakeCase,
  cases: readonly IntakeCase[],
): IntakeSourceLink | null {
  const byId = new Map(cases.map((item) => [item.id, item] as const))
  const visited = new Set<string>()
  let current: IntakeCase | undefined = intakeCase
  let reopenedDepth = 0

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.sourcePostId) return { sourcePostId: current.sourcePostId, reopenedDepth }
    if (!current.reopenedFromId) return null
    current = byId.get(current.reopenedFromId)
    reopenedDepth += 1
  }

  return null
}

/** Read only the validated A+ synthetic rehearsal archive; never repairs or writes it. */
export function readLocalIntakeProgress(): IntakeProgressSnapshot {
  let storage: Storage | null
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage
  } catch {
    storage = null
  }
  if (!storage) return { state: 'unavailable', records: [] }

  let raw: string | null
  try {
    raw = storage.getItem(INTAKE_STORAGE_KEY)
  } catch {
    return { state: 'unavailable', records: [] }
  }
  if (raw === null) return { state: 'missing', records: [] }

  const parsed = parseIntakeBackup(raw)
  if (!parsed.ok) return { state: 'unavailable', records: [] }

  const recordsByPostId = new Map<string, { record: LocalIntakeProgress; reopenedDepth: number }>()
  for (const item of parsed.backup.cases) {
    const sourceLink = resolveIntakeSourceLink(item, parsed.backup.cases)
    if (!sourceLink) continue
    const latestEvent = item.events.reduce<IntakeEvent | null>((latest, event) => {
      if (!latest || Date.parse(event.at) >= Date.parse(latest.at)) return event
      return latest
    }, null)
    const record: LocalIntakeProgress = {
      sourcePostId: sourceLink.sourcePostId,
      status: item.status,
      updatedAt: item.updatedAt,
      latestEvent: latestEvent ? { kind: latestEvent.kind, at: latestEvent.at } : null,
    }
    const previous = recordsByPostId.get(sourceLink.sourcePostId)
    if (
      !previous
      || sourceLink.reopenedDepth > previous.reopenedDepth
      || (sourceLink.reopenedDepth === previous.reopenedDepth
        && Date.parse(record.updatedAt) >= Date.parse(previous.record.updatedAt))
    ) {
      recordsByPostId.set(sourceLink.sourcePostId, { record, reopenedDepth: sourceLink.reopenedDepth })
    }
  }

  return { state: 'ready', records: [...recordsByPostId.values()].map(({ record }) => record) }
}

export function describeLatestIntakeActivity(record: LocalIntakeProgress): string {
  switch (record.latestEvent?.kind) {
    case 'created': return '已登记到本机受理队列'
    default: return '受理记录已更新'
  }
}
