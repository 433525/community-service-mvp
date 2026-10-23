// Local publish-draft persistence for the synthetic community demo.
// Drafts contain only synthetic text the user typed in this browser; they are
// never uploaded, shared or included in the community state envelope.

import { POST_MODES, VOLUNTEER_POST_KINDS, type PostMode, type VolunteerPostKind } from './types'

export const PUBLISH_DRAFT_STORAGE_KEY = 'community-mvp.publish-draft.v1'

const MAX_DRAFT_CHARS = 20_000

export interface PublishDraft {
  readonly mode: PostMode
  readonly title: string
  readonly content: string
  readonly location: string
  readonly category: string
  readonly timeWindow: string
  readonly duration: string
  readonly specialNote: string
  readonly volunteerKind: VolunteerPostKind
  readonly eventStartsAt: string
  readonly eventCapacity: string
  readonly anonymous: boolean
  readonly publishedToFeed: boolean
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * Read a draft without trusting stored content. Invalid shapes are discarded
 * instead of repaired; the synthetic-confirmation checkbox is deliberately
 * never restored, so the user must confirm again before submitting.
 */
export function readPublishDraft(): PublishDraft | null {
  const storage = getStorage()
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(PUBLISH_DRAFT_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null || raw.length > MAX_DRAFT_CHARS) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const mode = typeof value.mode === 'string' && POST_MODES.includes(value.mode as PostMode)
    ? value.mode as PostMode
    : 'help'
  const volunteerKind = typeof value.volunteerKind === 'string'
    && VOLUNTEER_POST_KINDS.includes(value.volunteerKind as VolunteerPostKind)
    ? value.volunteerKind as VolunteerPostKind
    : 'update'
  const title = text(value.title, 120)
  const content = text(value.content, 2_000)
  if (!title.trim() && !content.trim()) return null

  return {
    mode,
    title,
    content,
    location: text(value.location, 120),
    category: text(value.category, 240),
    timeWindow: text(value.timeWindow, 240),
    duration: text(value.duration, 240),
    specialNote: text(value.specialNote, 240),
    volunteerKind,
    eventStartsAt: text(value.eventStartsAt, 64),
    eventCapacity: text(value.eventCapacity, 16),
    anonymous: value.anonymous === true,
    publishedToFeed: value.publishedToFeed !== false,
  }
}

export function writePublishDraft(draft: PublishDraft): boolean {
  const storage = getStorage()
  if (!storage) return false
  const serialized = JSON.stringify(draft)
  if (serialized.length > MAX_DRAFT_CHARS) return false
  try {
    storage.setItem(PUBLISH_DRAFT_STORAGE_KEY, serialized)
    return true
  } catch {
    return false
  }
}

export function clearPublishDraft(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(PUBLISH_DRAFT_STORAGE_KEY)
  } catch {
    /* ignore: draft cleanup must never break publishing */
  }
}
