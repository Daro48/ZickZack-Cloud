async function readJson(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || fallbackMessage)
  }
  return data
}

export function mediaKey(item) {
  return `${item.type}-${item.id}`
}

export async function fetchCommunityUsers() {
  const response = await fetch('/bp/community/users', {
    credentials: 'include',
  })
  return readJson(response, 'User konnten nicht geladen werden.')
}

export async function fetchCommunity() {
  const response = await fetch('/bp/community', {
    credentials: 'include',
  })
  return readJson(response, 'Community konnte nicht geladen werden.')
}

export async function createShare(payload) {
  const response = await fetch('/bp/community/shares', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return readJson(response, 'Teilen fehlgeschlagen.')
}

export async function fetchShareMedia(shareId, { offset = 0, limit = 200 } = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  const response = await fetch(
    `/bp/community/shares/${shareId}/media?${params.toString()}`,
    { credentials: 'include' },
  )
  return readJson(response, 'Geteilte Inhalte konnten nicht geladen werden.')
}

export async function deleteShare(shareId) {
  const response = await fetch(`/bp/community/shares/${shareId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response, 'Freigabe konnte nicht beendet werden.')
}

export async function leaveShare(shareId) {
  const response = await fetch(`/bp/community/shares/${shareId}/leave`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response, 'Freigabe konnte nicht verlassen werden.')
}

export async function deleteNotification(notificationId) {
  const response = await fetch(`/bp/community/notifications/${notificationId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response, 'Mitteilung konnte nicht gelöscht werden.')
}

export async function fetchNotifications() {
  const response = await fetch('/bp/community/notifications', {
    credentials: 'include',
  })
  return readJson(response, 'Benachrichtigungen konnten nicht geladen werden.')
}

export async function markNotificationsRead() {
  const response = await fetch('/bp/community/notifications/read', {
    method: 'POST',
    credentials: 'include',
  })
  return readJson(response, 'Benachrichtigungen konnten nicht gelesen werden.')
}

export async function fetchFeed({ offset = 0, limit = 12 } = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  const response = await fetch(`/bp/community/feed?${params.toString()}`, {
    credentials: 'include',
  })
  return readJson(response, 'Feed konnte nicht geladen werden.')
}

export async function toggleFeedLike(item) {
  const response = await fetch('/bp/community/feed/like', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: item.type, id: item.id }),
  })
  return readJson(response, 'Like konnte nicht gespeichert werden.')
}

export async function createFeedComment(item, body) {
  const response = await fetch('/bp/community/feed/comments', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: item.type, id: item.id, body }),
  })
  return readJson(response, 'Kommentar konnte nicht gespeichert werden.')
}

export async function deleteFeedComment(commentId) {
  const response = await fetch(`/bp/community/feed/comments/${commentId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return readJson(response, 'Kommentar konnte nicht gelöscht werden.')
}
