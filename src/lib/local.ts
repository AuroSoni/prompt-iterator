// Thin, safe wrappers around window.localStorage — every Web Storage access in
// the app goes through here. Failures (quota, disabled storage, corrupt JSON)
// degrade to null/false; callers decide whether that's worth surfacing.
// Keys are versioned ("pw:v1:…") so the schema can evolve without migrations.

export function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

/** Returns false when the write failed (quota exceeded, storage disabled). */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing sensible to do — the key either never existed or storage is gone.
  }
}
