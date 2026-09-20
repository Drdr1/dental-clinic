/**
 * Print pages open in a new tab, so window.close() is usually blocked
 * (browsers only allow it for tabs a script opened). Try to close, and if the
 * tab is still here a moment later, go back instead.
 */
export function closeOrBack() {
  window.close()
  setTimeout(() => {
    if (!window.closed) {
      if (window.history.length > 1) window.history.back()
      else window.location.assign('/patients')
    }
  }, 120)
}
