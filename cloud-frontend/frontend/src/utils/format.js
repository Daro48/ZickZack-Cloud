export function formatDayHeading(value) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return 'Ohne Aufnahmedatum'
  }
  const date = new Date(`${raw}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return 'Ohne Aufnahmedatum'
  }
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const ONLINE_MS = 2 * 60 * 1000
const presenceRelative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'always' })

function parseUtcDate(value) {
  if (!value) {
    return null
  }
  const raw = String(value).trim().replace(' ', 'T')
  const date = new Date(raw.endsWith('Z') ? raw : `${raw}Z`)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

export function formatPresence(value) {
  const date = parseUtcDate(value)
  if (!date) {
    return 'Noch nie gesehen'
  }

  const diffMs = date.getTime() - Date.now()
  const agoMs = Date.now() - date.getTime()
  if (agoMs < ONLINE_MS) {
    return 'Online'
  }

  const absSeconds = Math.round(Math.abs(diffMs) / 1000)
  if (absSeconds < 3600) {
    return presenceRelative.format(Math.round(diffMs / 60000), 'minute')
  }
  if (absSeconds < 86400) {
    return presenceRelative.format(Math.round(diffMs / 3600000), 'hour')
  }
  if (absSeconds < 86400 * 14) {
    return presenceRelative.format(Math.round(diffMs / 86400000), 'day')
  }
  return date.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(value) {
  if (!value) {
    return ''
  }
  const raw = String(value).replace(' ', 'T')
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString('de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export async function copyText(value) {
  const text = String(value || '')
  if (!text) {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function absoluteUrl(path) {
  if (!path) {
    return ''
  }
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  return `${window.location.origin}${path}`
}
