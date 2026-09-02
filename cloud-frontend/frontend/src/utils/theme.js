const THEME_KEY = 'cloud-theme'

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    if (value === 'light' || value === 'dark') {
      return value
    }
  } catch {
    // ignore
  }
  return 'dark'
}

export function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // ignore
  }
  return next
}

export function toggleTheme(current) {
  return applyTheme(current === 'light' ? 'dark' : 'light')
}
