import { useEffect, useRef, useState } from 'react'
import { fetchNotifications, markNotificationsRead } from '../services/communityApi.js'
import { fetchStorage } from '../services/mediaApi.js'
import { formatBytes } from '../utils/format.js'
import { applyTheme, getStoredTheme, toggleTheme } from '../utils/theme.js'

export function Topbar({
  action,
  username,
  center,
  onGoHome,
  onGoCommunity,
}) {
  const [theme, setTheme] = useState(() => getStoredTheme())
  const [storage, setStorage] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)
  const [inboxOpen, setInboxOpen] = useState(false)
  const inboxRef = useRef(null)

  const logo = (
    <>
      Cloud
      <span className="topbar-version">Version 1.2.0</span>
    </>
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (!username) {
      return undefined
    }

    let cancelled = false

    async function loadStorage() {
      try {
        const data = await fetchStorage()
        if (!cancelled) {
          setStorage(data)
        }
      } catch {
        if (!cancelled) {
          setStorage(null)
        }
      }
    }

    async function loadInbox() {
      try {
        const data = await fetchNotifications()
        if (!cancelled) {
          setNotifications(data.notifications || [])
          setUnread(data.unread || 0)
        }
      } catch {
        if (!cancelled) {
          setNotifications([])
          setUnread(0)
        }
      }
    }

    loadStorage()
    loadInbox()
    const storageTimer = window.setInterval(loadStorage, 60000)
    const inboxTimer = window.setInterval(loadInbox, 30000)
    function handleFocus() {
      loadStorage()
      loadInbox()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      cancelled = true
      window.clearInterval(storageTimer)
      window.clearInterval(inboxTimer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [username])

  useEffect(() => {
    if (!inboxOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!inboxRef.current?.contains(event.target)) {
        setInboxOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setInboxOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [inboxOpen])

  const used = storage?.used_bytes || 0
  const quota = storage?.quota_bytes || 0
  const percent =
    quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0

  async function openInbox() {
    const nextOpen = !inboxOpen
    setInboxOpen(nextOpen)
    if (nextOpen && unread > 0) {
      try {
        await markNotificationsRead()
        setUnread(0)
        setNotifications((current) =>
          current.map((entry) => ({ ...entry, read: true })),
        )
      } catch {
        // ignore
      }
    }
  }

  return (
    <header className="topbar">
      {onGoHome ? (
        <button
          aria-label="Zur Startseite"
          className="topbar-logo"
          onClick={onGoHome}
          type="button"
        >
          {logo}
        </button>
      ) : (
        <span className="topbar-logo">{logo}</span>
      )}

      <div className="topbar-center">{center}</div>

      <div className="topbar-meta">
        {username && storage && (
          <div
            className="storage-meter"
            title={`${formatBytes(used)} von ${formatBytes(quota)} belegt`}
          >
            <span className="storage-meter-label">
              <span className="storage-meter-percent">{percent}%</span>
              <span className="storage-meter-bytes">
                {formatBytes(used)} / {formatBytes(quota)}
              </span>
            </span>
            <span className="storage-meter-track" aria-hidden="true">
              <span
                className="storage-meter-fill"
                style={{ width: `${percent}%` }}
              />
            </span>
          </div>
        )}

        {username && (
          <div className="notify-wrap" ref={inboxRef}>
            <button
              aria-expanded={inboxOpen}
              aria-label={
                unread > 0
                  ? `${unread} neue Mitteilungen`
                  : 'Mitteilungen'
              }
              className={`notify-button${unread > 0 ? ' has-unread' : ''}`}
              onClick={openInbox}
              type="button"
            >
              Mitteilungen
              {unread > 0 && <span className="notify-badge">{unread}</span>}
            </button>
            {inboxOpen && (
              <div className="notify-panel" role="region" aria-label="Mitteilungen">
                {notifications.length === 0 ? (
                  <p className="notify-empty">Keine Benachrichtigungen.</p>
                ) : (
                  notifications.map((entry) => (
                    <button
                      className={`notify-item${entry.read ? '' : ' is-unread'}`}
                      key={entry.id}
                      onClick={() => {
                        setInboxOpen(false)
                        onGoCommunity?.()
                      }}
                      type="button"
                    >
                      {entry.message}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <button
          aria-label={theme === 'light' ? 'Dunkles Design' : 'Helles Design'}
          className="ghost-button theme-toggle"
          onClick={() => setTheme((current) => toggleTheme(current))}
          type="button"
        >
          {theme === 'light' ? 'Dunkel' : 'Hell'}
        </button>

        {username && <span className="topbar-user">{username.toUpperCase()}</span>}
        {action}
      </div>
    </header>
  )
}
