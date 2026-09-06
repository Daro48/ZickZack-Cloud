async function readJson(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || fallbackMessage)
  }
  return data
}

export async function sendAdminMessage({ body, audience, recipientId } = {}) {
  const payload = { body }
  if (audience) {
    payload.audience = audience
  }
  if (recipientId != null) {
    payload.recipient_id = recipientId
  }
  const response = await fetch('/bp/feedback', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return readJson(response, 'Nachricht konnte nicht gesendet werden.')
}

export async function fetchAdminMessages() {
  const response = await fetch('/bp/feedback', {
    credentials: 'include',
  })
  return readJson(response, 'Nachrichten konnten nicht geladen werden.')
}
