import { useEffect, useRef, useState } from 'react'
import {
  deleteNotification,
  fetchNotifications,
  markNotificationsRead,
} from '../services/communityApi.js'
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
  const [deletingId, setDeletingId] = useState(null)
  const inboxRef = useRef(null)

  const logo = (
    <>
      Cloud
      <span className="topbar-version">Version 3.0.0</span>
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

  async function handleDeleteNotification(entry) {
    if (!entry?.id || deletingId) {
      return
    }
    setDeletingId(entry.id)
    try {
      await deleteNotification(entry.id)
      setNotifications((current) =>
        current.filter((item) => item.id !== entry.id),
      )
      if (!entry.read) {
        setUnread((current) => Math.max(0, current - 1))
      }
    } catch {
      // keep the item; the next inbox refresh restores server state
    } finally {
      setDeletingId(null)
    }
  }

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
      <div className="topbar-start">
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

        {username && storage && (
          <div
            aria-label={`Speicher ${percent} Prozent, ${formatBytes(used)} von ${formatBytes(quota)}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="storage-meter"
            role="meter"
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
      </div>

      <div className="topbar-center">{center}</div>

      <div className="topbar-end">
        <div className="topbar-meta">
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
                <svg
                  aria-hidden="true"
                  className="notify-bell"
                  fill="none"
                  focusable="false"
                  height="20"
                  viewBox="0 0 24 24"
                  width="20"
                >
                  <path
                    d="M6 9a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M10 21a2 2 0 0 0 4 0"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                {unread > 0 && <span className="notify-badge">{unread}</span>}
              </button>
              {inboxOpen && (
                <div className="notify-panel" role="region" aria-label="Mitteilungen">
                  {notifications.length === 0 ? (
                    <p className="notify-empty">Keine Benachrichtigungen.</p>
                  ) : (
                    notifications.map((entry) => (
                      <div className="notify-row" key={entry.id}>
                        <button
                          className={`notify-item${entry.read ? '' : ' is-unread'}`}
                          onClick={() => {
                            setInboxOpen(false)
                            onGoCommunity?.()
                          }}
                          type="button"
                        >
                          {entry.message}
                        </button>
                        <button
                          aria-label="Mitteilung löschen"
                          className="notify-dismiss"
                          disabled={deletingId === entry.id}
                          onClick={() => handleDeleteNotification(entry)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
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
            {theme === 'light' ? (
              <svg
                aria-hidden="true"
                className="theme-toggle-icon"
                fill="none"
                focusable="false"
                height="20"
                viewBox="0 0 24 24"
                width="20"
              >
                <path
                  d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="theme-toggle-icon"
                fill="none"
                focusable="false"
                height="20"
                viewBox="0 0 24 24"
                width="20"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M12 3v1.6M12 19.4V21M4.93 4.93l1.13 1.13M17.94 17.94l1.13 1.13M3 12h1.6M19.4 12H21M4.93 19.07l1.13-1.13M17.94 6.06l1.13-1.13"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.8"
                />
              </svg>
            )}
          </button>

          {username && <span className="topbar-user">{username.toUpperCase()}</span>}
          {action}
        </div>
      </div>
    </header>
  )
}
