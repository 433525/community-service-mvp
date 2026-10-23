// Local-only UI preference for the moderation workbench filters.
// This is not moderation data and never leaves the browser.

import type { AuditAction } from './types'

export type ContentFilter = 'all' | 'pending' | 'approved' | 'hidden' | 'rejected'
export type CommentFilter = 'pending' | 'approved' | 'rejected' | 'hidden' | 'all'
export type ReportFilter = 'pending' | 'resolved' | 'dismissed' | 'all'
export type MessageFilter = 'all' | 'visible' | 'hidden'
export type AuditFilter = 'all' | AuditAction

export interface ModerationFilterPrefs {
  content: ContentFilter
  comment: CommentFilter
  report: ReportFilter
  message: MessageFilter
  audit: AuditFilter
}

export const MODERATION_FILTERS_KEY = 'community-mvp.moderation-filters.v1'

export const DEFAULT_MODERATION_FILTERS: ModerationFilterPrefs = {
  content: 'all',
  comment: 'pending',
  report: 'pending',
  message: 'all',
  audit: 'all',
}

const CONTENT_VALUES: readonly ContentFilter[] = ['all', 'pending', 'approved', 'hidden', 'rejected']
const COMMENT_VALUES: readonly CommentFilter[] = ['pending', 'approved', 'rejected', 'hidden', 'all']
const REPORT_VALUES: readonly ReportFilter[] = ['pending', 'resolved', 'dismissed', 'all']
const MESSAGE_VALUES: readonly MessageFilter[] = ['all', 'visible', 'hidden']
const AUDIT_VALUES: readonly AuditFilter[] = ['all', 'moderate-post', 'moderate-comment', 'resolve-report', 'hide-message', 'create-report']

function pick<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value) ? value as T : fallback
}

export function readModerationFilters(): ModerationFilterPrefs {
  try {
    const storage = window.localStorage
    const raw = storage.getItem(MODERATION_FILTERS_KEY)
    if (!raw) return { ...DEFAULT_MODERATION_FILTERS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_MODERATION_FILTERS }
    }
    const value = parsed as Record<string, unknown>
    return {
      content: pick(value.content, CONTENT_VALUES, DEFAULT_MODERATION_FILTERS.content),
      comment: pick(value.comment, COMMENT_VALUES, DEFAULT_MODERATION_FILTERS.comment),
      report: pick(value.report, REPORT_VALUES, DEFAULT_MODERATION_FILTERS.report),
      message: pick(value.message, MESSAGE_VALUES, DEFAULT_MODERATION_FILTERS.message),
      audit: pick(value.audit, AUDIT_VALUES, DEFAULT_MODERATION_FILTERS.audit),
    }
  } catch {
    return { ...DEFAULT_MODERATION_FILTERS }
  }
}

export function writeModerationFilters(prefs: ModerationFilterPrefs): void {
  try {
    window.localStorage.setItem(MODERATION_FILTERS_KEY, JSON.stringify(prefs))
  } catch {
    // Preference storage failure must never block moderation.
  }
}
