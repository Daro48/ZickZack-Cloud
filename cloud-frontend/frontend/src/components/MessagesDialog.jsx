import { useEffect, useMemo, useState } from 'react'
import { fetchCommunityUsers } from '../services/communityApi.js'
import { fetchAdminMessages, sendAdminMessage } from '../services/feedbackApi.js'
import { formatDateTime } from '../utils/format.js'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { SelectMenu } from './SelectMenu.jsx'

const MAX_BODY_LENGTH = 1000

function messageKicker(entry) {
  if (entry.mine && entry.audience === 'all') {
    return 'An alle'
  }
  if (entry.mine && entry.audience === 'user') {
    return `An ${entry.recipient_username || 'einen User'}`
  }
  if (entry.mine && entry.audience === 'admin') {
    return 'An Admin'
  }
  if (entry.audience === 'all') {
    return 'Von Admin an alle'
  }
  if (entry.audience === 'user') {
    return 'Von Admin'
  }
  return `Von ${entry.username}`
}

export function MessagesDialog({ isAdmin = false, onClose }) {
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('all')
  const [recipientId, setRecipientId] = useState('')
  const [users, setUsers] = useState([])
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [sendError, setSendError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const trimmed = body.trim()
  const tooLong = body.length > MAX_BODY_LENGTH
  const needsRecipient = isAdmin && audience === 'user'
  const confirmDisabled =
    !trimmed || tooLong || busy || (needsRecipient && !recipientId)

  const userOptions = useMemo(
    () => [
      { value: '', label: 'User wählen' },
      ...users.map((entry) => ({
        value: String(entry.id),
        label: entry.username,
      })),
    ],
    [users],
  )

  async function loadMessages() {
    setIsLoading(true)
    setListError('')
    try {
      const data = await fetchAdminMessages()
      setMessages(data.messages || [])
    } catch (error) {
      setListError(error.message)
      setMessages([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadMessages()
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      return undefined
    }

    let cancelled = false
    fetchCommunityUsers()
      .then((data) => {
        if (!cancelled) {
          setUsers(data.users || [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin])

  function replyToUser(entry) {
    if (!isAdmin || entry.mine || entry.audience !== 'admin') {
      return
    }
    setAudience('user')
    if (entry.sender_id) {
      setRecipientId(String(entry.sender_id))
    }
    setNotice(`Antwort an ${entry.username}`)
    setSendError('')
  }

  async function handleSend() {
    if (confirmDisabled) {
      return
    }
    setBusy(true)
    setSendError('')
    setNotice('')
    try {
      await sendAdminMessage({
        body: trimmed,
        audience: isAdmin ? audience : undefined,
        recipientId:
          isAdmin && audience === 'user' ? Number(recipientId) : undefined,
      })
      setBody('')
      setNotice(
        isAdmin
          ? audience === 'all'
            ? 'Antwort an alle gesendet.'
            : 'Antwort gesendet.'
          : 'Nachricht an Admin gesendet.',
      )
      await loadMessages()
    } catch (error) {
      setSendError(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      busy={busy}
      busyLabel="Wird gesendet…"
      cancelLabel="Schließen"
      confirmDisabled={confirmDisabled}
      confirmLabel={isAdmin ? 'Antwort senden' : 'Nachricht senden'}
      description={
        isAdmin
          ? 'Antworte einem User oder allen. Nachrichten an dich siehst nur du.'
          : 'Schreib Daniel, was verbessert werden soll. Antworten erscheinen hier.'
      }
      error={
        sendError ||
        (tooLong
          ? `Höchstens ${MAX_BODY_LENGTH} Zeichen. Noch ${body.length - MAX_BODY_LENGTH} zu viel.`
          : '')
      }
      onCancel={onClose}
      onConfirm={handleSend}
      title="Nachrichten"
    >
      {isAdmin && (
        <div
          className="community-tabs share-audience"
          role="radiogroup"
          aria-label="Empfänger"
        >
          <button
            aria-checked={audience === 'all'}
            className={`community-tab${audience === 'all' ? ' is-active' : ''}`}
            onClick={() => {
              setAudience('all')
              setNotice('')
            }}
            role="radio"
            type="button"
          >
            Alle User
          </button>
          <button
            aria-checked={audience === 'user'}
            className={`community-tab${audience === 'user' ? ' is-active' : ''}`}
            onClick={() => {
              setAudience('user')
              setNotice('')
            }}
            role="radio"
            type="button"
          >
            Einen User
          </button>
        </div>
      )}

      {isAdmin && audience === 'user' && (
        <SelectMenu
          label="User"
          onChange={(value) => {
            setRecipientId(value)
            setNotice('')
          }}
          options={userOptions}
          value={recipientId}
        />
      )}

      <label className="folder-field">
        <span className="folder-field-label">Nachricht</span>
        <textarea
          className="share-note-input"
          disabled={busy}
          maxLength={MAX_BODY_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            isAdmin
              ? audience === 'all'
                ? 'Antwort an alle User'
                : 'Antwort an diesen User'
              : 'Was soll verbessert werden?'
          }
          rows={4}
          value={body}
        />
      </label>

      {notice && <p className="form-success">{notice}</p>}

      {isLoading ? (
        <p className="account-messages-status">Nachrichten werden geladen.</p>
      ) : listError ? (
        <div className="account-messages">
          <p className="form-error">{listError}</p>
          <button className="ghost-button" onClick={loadMessages} type="button">
            Erneut laden
          </button>
        </div>
      ) : messages.length === 0 ? (
        <p className="account-messages-status">Noch keine Nachrichten.</p>
      ) : (
        <div className="account-messages" aria-label="Nachrichtenverlauf">
          {messages.map((entry) => (
            <article className="account-message" key={entry.id}>
              <div className="account-message-meta">
                <strong>{messageKicker(entry)}</strong>
                <time dateTime={entry.created_at}>
                  {formatDateTime(entry.created_at)}
                </time>
              </div>
              <p className="account-message-body">{entry.body}</p>
              {isAdmin && !entry.mine && entry.audience === 'admin' && (
                <button
                  className="ghost-button"
                  onClick={() => replyToUser(entry)}
                  type="button"
                >
                  Diesem User antworten
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </ConfirmDialog>
  )
}
