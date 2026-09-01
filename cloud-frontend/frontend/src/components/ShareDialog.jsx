import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createShare, fetchCommunityUsers } from '../services/communityApi.js'

export function ShareDialog({ kind, folder, items = [], onClose, onShared }) {
  const [users, setUsers] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const itemCount = items.length
  const title =
    kind === 'folder'
      ? `Ordner ${folder} teilen`
      : `${itemCount === 1 ? '1 Datei' : `${itemCount} Dateien`} teilen`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let cancelled = false

    async function loadUsers() {
      setIsLoading(true)
      setError('')
      try {
        const data = await fetchCommunityUsers()
        if (cancelled) {
          return
        }
        setUsers(data.users || [])
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadUsers()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelled = true
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const allSelected = users.length > 0 && selectedIds.size === users.length
  const selectedCount = selectedIds.size

  const summary = useMemo(() => {
    if (kind === 'folder') {
      return `Der Ordner bleibt bei dir gespeichert. Andere sehen denselben Inhalt, auch neue Uploads.`
    }
    return 'Die markierten Dateien bleiben bei dir gespeichert. Andere sehen nur diese Auswahl.'
  }, [kind])

  function toggleUser(userId) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(users.map((entry) => entry.id)))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSaving || selectedCount === 0) {
      return
    }

    setIsSaving(true)
    setError('')
    try {
      const payload =
        kind === 'folder'
          ? {
              kind: 'folder',
              folder,
              all: allSelected,
              user_ids: [...selectedIds],
            }
          : {
              kind: 'items',
              items: items.map((item) => ({ type: item.type, id: item.id })),
              all: allSelected,
              user_ids: [...selectedIds],
            }
      const data = await createShare(payload)
      onShared?.(data.share)
    } catch (saveError) {
      setError(saveError.message)
      setIsSaving(false)
    }
  }

  return createPortal(
    <div
      aria-labelledby="share-dialog-title"
      aria-modal="true"
      className="share-dialog"
      role="dialog"
    >
      <form className="share-dialog-panel" onSubmit={handleSubmit}>
        <div className="share-dialog-toolbar">
          <div className="share-dialog-heading">
            <span>Community</span>
            <h2 id="share-dialog-title">{title}</h2>
          </div>
          <button
            className="ghost-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
        </div>

        <p className="share-dialog-copy">{summary}</p>

        {isLoading ? (
          <p className="folder-hint">User werden geladen…</p>
        ) : users.length === 0 ? (
          <div className="empty-panel">
            <p>Keine anderen User.</p>
            <span>Teilen ist erst möglich, wenn weitere Accounts existieren.</span>
          </div>
        ) : (
          <div className="share-user-list" role="group" aria-label="User wählen">
            <button
              className={`share-user-option${allSelected ? ' is-active' : ''}`}
              onClick={toggleAll}
              type="button"
            >
              Alle auswählen
            </button>
            {users.map((entry) => {
              const isActive = selectedIds.has(entry.id)
              return (
                <button
                  className={`share-user-option${isActive ? ' is-active' : ''}`}
                  key={entry.id}
                  onClick={() => toggleUser(entry.id)}
                  type="button"
                >
                  {entry.username}
                </button>
              )
            })}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button
          className="primary-button share-dialog-submit"
          disabled={isSaving || isLoading || selectedCount === 0 || users.length === 0}
          type="submit"
        >
          {isSaving
            ? 'Wird geteilt…'
            : selectedCount === 1
              ? 'Mit 1 User teilen'
              : `Mit ${selectedCount} Usern teilen`}
        </button>
      </form>
    </div>,
    document.body,
  )
}
