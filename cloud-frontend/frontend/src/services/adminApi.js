async function readJson(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || fallbackMessage)
  }
  return data
}

export async function fetchAdminUsers() {
  const response = await fetch('/bp/admin/users', {
    credentials: 'include',
  })
  return readJson(response, 'User konnten nicht geladen werden.')
}
