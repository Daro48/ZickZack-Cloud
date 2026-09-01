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
