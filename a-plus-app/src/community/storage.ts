// Shared local-storage contract for the synthetic community demo.
// Read-only consumers (the A+ bridge) must never write to this key.

export const COMMUNITY_STORAGE_KEY = 'community-mvp.synthetic-state.v1'
export const COMMUNITY_STORAGE_SCHEMA_VERSION = 1
