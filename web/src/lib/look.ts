import { useSyncExternalStore } from 'react'

// Which look the app shows: the current one, or the new one on trial.
// Kept per browser, so each person can switch and compare without
// changing anything for the rest of the clinic.
export type Look = 'classic' | 'new'

const KEY = 'dentano.look'
const listeners = new Set<() => void>()

function read(): Look {
  try {
    return localStorage.getItem(KEY) === 'new' ? 'new' : 'classic'
  } catch {
    return 'classic'
  }
}

function apply(look: Look) {
  document.documentElement.classList.toggle('look-new', look === 'new')
}

apply(read())

export function setLook(look: Look) {
  try { localStorage.setItem(KEY, look) } catch { /* private window: this visit only */ }
  apply(look)
  listeners.forEach((l) => l())
}

export function useLook(): Look {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    read,
    () => 'classic',
  )
}
