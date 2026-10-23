// Reading preference for the synthetic community demo.
// This is a UI preference only, stored locally; it is never synced or sent.

export const READING_MODE_STORAGE_KEY = 'community-mvp.reading-mode.v1'

export type ReadingMode = 'normal' | 'large'

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readReadingMode(): ReadingMode {
  const storage = getStorage()
  if (!storage) return 'normal'
  try {
    return storage.getItem(READING_MODE_STORAGE_KEY) === 'large' ? 'large' : 'normal'
  } catch {
    return 'normal'
  }
}

/** Returns false when the browser refuses to persist the preference. */
export function writeReadingMode(mode: ReadingMode): boolean {
  const storage = getStorage()
  if (!storage) return false
  try {
    if (mode === 'large') storage.setItem(READING_MODE_STORAGE_KEY, 'large')
    else storage.removeItem(READING_MODE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
