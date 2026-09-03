import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createShare, fetchCommunityUsers } from '../services/communityApi.js'
import { fetchFolders } from '../services/mediaApi.js'

export function ShareDialog({
  kind,
  folder,
  folders = [],
  items = [],
  onClose,
  onShared,
}) {
  const [users, setUsers] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [audience, setAudience] = useState('users')
  const [availableFolders, setAvailableFolders] = useState(folders)
  const [selectedFolders, setSelectedFolders] = useState(() => new Set(folders.length ? folders : folder ? [folder] : []))
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const isFolderShare = kind === 'folder' || kind === 'folders'
  const itemCount = items.length
  const folderCount = selectedFolders.size
  const title = isFolderShare
    ? folderCount <= 1
      ? `Ordner ${[...selectedFolders][0] || folder || ''} teilen`
      : `${folderCount} Ordner teilen`
    : `${itemCount === 1 ? '1 Datei' : `${itemCount} Dateien`} teilen`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError('')
      try {
        const [userData, folderData] = await Promise.all([
          fetchCommunityUsers(),
          isFolderShare ? fetchFolders() : Promise.resolve({ folders: [] }),
        ])
        if (cancelled) {
          return
        }
        setUsers(
          (userData.users || [])
            .map((entry) => ({
              ...entry,
              id: Number(entry.id),
            }))
            .filter((entry) => Number.isInteger(entry.id) && entry.id > 0),
        )
        if (isFolderShare) {
          const nextFolders = folderData.folders || []
          setAvailableFolders(nextFolders)
          setSelectedFolders((current) => {
            if (current.size > 0) {
              return current
            }
            if (folder && nextFolders.includes(folder)) {
              return new Set([folder])
            }
            return current
          })
        }
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

    load()

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
  }, [folder, isFolderShare, onClose])

  const selectedCount = selectedIds.size
  const shareWithEveryone = audience === 'everyone'

  const summary = useMemo(() => {
    if (shareWithEveryone) {
      return 'Die Dateien bleiben bei dir gespeichert. Jeder eingeloggte User sieht sie im Feed und kann liken oder kommentieren.'
    }
    if (isFolderShare) {
      return 'Die Ordner bleiben bei dir gespeichert. Andere sehen denselben Inhalt, auch neue Uploads.'
    }
    return 'Die markierten Dateien bleiben bei dir gespeichert. Andere sehen nur diese Auswahl.'
  }, [isFolderShare, shareWithEveryone])

  function toggleUser(userId) {
    const id = Number(userId)
    if (!Number.isInteger(id) || id < 1) {
      return
    }
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleFolder(name) {
    if (kind === 'folder') {
      return
    }
    setSelectedFolders((current) => {
      const next = new Set(current)
      if (next.has(name)) {
        if (next.size === 1) {
          return current
        }
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const targetFolder = folder || [...selectedFolders][0]
    if (isSaving) {
      return
    }
    if (!shareWithEveryone && selectedCount === 0) {
      return
    }
    if (isFolderShare && !targetFolder && selectedFolders.size === 0) {
      setError('Bitte mindestens einen Ordner wählen.')
      return
    }

    setIsSaving(true)
    setError('')
    try {
      const chosenFolders =
        kind === 'folder' && targetFolder
          ? [targetFolder]
          : [...selectedFolders]
      const recipientIds = [...selectedIds]
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
      if (!shareWithEveryone && recipientIds.length === 0) {
        setError('Bitte mindestens einen User wählen.')
        setIsSaving(false)
        return
      }
      const payload = isFolderShare
        ? {
            kind: chosenFolders.length > 1 ? 'folders' : 'folder',
            folder: chosenFolders[0],
            folders: chosenFolders,
            audience,
            note: note.trim(),
          }
        : {
            kind: 'items',
            items: items.map((item) => ({ type: item.type, id: item.id })),
            audience,
            note: note.trim(),
          }
      if (!shareWithEveryone) {
        payload.user_ids = recipientIds
      }
      const data = await createShare(payload)
      const shares = data?.shares || (data?.share ? [data.share] : [])
      const savedRecipients = shares.reduce(
        (total, share) => total + (share.recipients || []).length,
        0,
      )
      const postedToFeed = shares.some((share) => share.audience === 'everyone')
      if (shares.length === 0 || (!postedToFeed && savedRecipients === 0)) {
        throw new Error(
          'Die Freigabe wurde nicht an die Empfänger übergeben. Bitte erneut teilen.',
        )
      }
      onShared?.(data)
    } catch (saveError) {
      setError(saveError.message)
      setIsSaving(false)
    }
  }

  function handleBackdrop(event) {
    if (event.target === event.currentTarget && !isSaving) {
      onClose()
    }
  }

  return createPortal(
    <div
      aria-labelledby="share-dialog-title"
      aria-modal="true"
      className="share-dialog"
      onMouseDown={handleBackdrop}
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

        <div
          className="community-tabs share-audience"
          role="radiogroup"
          aria-label="Für wen teilen"
        >
          <button
            aria-checked={audience === 'users'}
            className={`community-tab${audience === 'users' ? ' is-active' : ''}`}
            onClick={() => {
              setAudience('users')
              setError('')
            }}
            role="radio"
            type="button"
          >
            Ausgewählte Personen
          </button>
          <button
            aria-checked={audience === 'everyone'}
            className={`community-tab${audience === 'everyone' ? ' is-active' : ''}`}
            onClick={() => {
              setAudience('everyone')
              setError('')
            }}
            role="radio"
            type="button"
          >
            Alle im Feed
          </button>
        </div>

        {kind === 'folder' && (folder || [...selectedFolders][0]) && (
          <p className="folder-hint">
            Ordner: {folder || [...selectedFolders][0]}
          </p>
        )}

        {kind === 'folders' && availableFolders.length > 0 && (
          <div className="share-user-list is-compact" role="group" aria-label="Ordner wählen">
            {availableFolders.map((entry) => {
              const isActive = selectedFolders.has(entry)
              return (
                <button
                  className={`share-user-option${isActive ? ' is-active' : ''}`}
                  key={entry}
                  onClick={() => toggleFolder(entry)}
                  type="button"
                >
                  {entry}
                </button>
              )
            })}
          </div>
        )}

        {shareWithEveryone ? (
          <p className="folder-hint">
            Keine Empfängerliste nötig. Der Beitrag erscheint auf der Startseite
            im Feed.
          </p>
        ) : isLoading ? (
          <p className="folder-hint">User werden geladen…</p>
        ) : users.length === 0 ? (
          <div className="empty-panel">
            <p>Keine anderen User.</p>
            <span>Teilen mit Personen ist erst möglich, wenn weitere Accounts existieren. Du kannst trotzdem für den Feed teilen.</span>
          </div>
        ) : (
          <div className="share-user-list" role="group" aria-label="Empfänger wählen">
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

        <label className="folder-field">
          <span className="folder-field-label">Notiz (optional)</span>
          <textarea
            className="share-note-input"
            maxLength={280}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              shareWithEveryone
                ? 'Kurzer Hinweis im Feed'
                : 'Kurzer Hinweis für die Empfänger'
            }
            rows={2}
            value={note}
          />
        </label>

        {error && <p className="form-error">{error}</p>}
        {!error && !isLoading && !shareWithEveryone && users.length > 0 && selectedCount === 0 && (
          <p className="folder-hint">
            Wähle mindestens eine Person, oder teile im Feed mit allen.
          </p>
        )}

        <button
          className="primary-button share-dialog-submit"
          disabled={
            isSaving ||
            (!shareWithEveryone &&
              (isLoading || selectedCount === 0 || users.length === 0)) ||
            (kind === 'folders' && selectedFolders.size === 0) ||
            (kind === 'folder' && !(folder || selectedFolders.size))
          }
          type="submit"
        >
          {isSaving
            ? 'Wird geteilt…'
            : shareWithEveryone
              ? 'Im Feed teilen'
              : selectedCount === 1
                ? 'Mit 1 Person teilen'
                : `Mit ${selectedCount} Personen teilen`}
        </button>
      </form>
    </div>,
    document.body,
  )
}
