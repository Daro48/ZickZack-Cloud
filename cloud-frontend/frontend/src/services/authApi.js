const jsonHeaders = {
  'Content-Type': 'application/json',
}

async function requestAuth(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.')
  }

  return data
}

async function requestSession(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.')
  }

  return data
}

export function registerUser({ username, password }) {
  return requestAuth('/bp/auth/register', { username, password })
}

export function resetPassword({ username, recoveryCode, password }) {
  return requestAuth('/bp/auth/reset-password', {
    username,
    recovery_code: recoveryCode,
    password,
  })
}

export function loginUser({ username, password }) {
  return requestAuth('/bp/auth/login', { username, password })
}

export function getCurrentUser() {
  return requestSession('/bp/auth/me')
}

export function logoutUser() {
  return requestSession('/bp/auth/logout', { method: 'POST' })
}
