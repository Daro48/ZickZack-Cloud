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

  const allSelected = users.length > 0 && selectedIds.size === users.length
  const selectedCount = selectedIds.size

  const summary = useMemo(() => {
    if (isFolderShare) {
      return 'Die Ordner bleiben bei dir gespeichert. Andere sehen denselben Inhalt, auch neue Uploads.'
    }
    return 'Die markierten Dateien bleiben bei dir gespeichert. Andere sehen nur diese Auswahl.'
  }, [isFolderShare])

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

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(
      new Set(
        users
          .map((entry) => Number(entry.id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    )
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
    if (isSaving || selectedCount === 0) {
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
      if (recipientIds.length === 0) {
        setError('Bitte mindestens einen User wählen.')
        setIsSaving(false)
        return
      }
      const payload = isFolderShare
        ? {
            kind: chosenFolders.length > 1 ? 'folders' : 'folder',
            folder: chosenFolders[0],
            folders: chosenFolders,
            user_ids: recipientIds,
            note: note.trim(),
          }
        : {
            kind: 'items',
            items: items.map((item) => ({ type: item.type, id: item.id })),
            user_ids: recipientIds,
            note: note.trim(),
          }
      const data = await createShare(payload)
      const shares = data?.shares || (data?.share ? [data.share] : [])
      const savedRecipients = shares.reduce(
        (total, share) => total + (share.recipients || []).length,
        0,
      )
      if (shares.length === 0 || savedRecipients === 0) {
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

        {isLoading ? (
          <p className="folder-hint">User werden geladen…</p>
        ) : users.length === 0 ? (
          <div className="empty-panel">
            <p>Keine anderen User.</p>
            <span>Teilen ist erst möglich, wenn weitere Accounts existieren.</span>
          </div>
        ) : (
          <div className="share-user-list" role="group" aria-label="Empfänger wählen">
            <button
              aria-pressed={allSelected}
              className={`share-user-option is-all${allSelected ? ' is-active' : ''}`}
              onClick={toggleAll}
              type="button"
            >
              <span className="share-user-option-copy">
                <strong>Alle auswählen</strong>
                <em>
                  {allSelected
                    ? `Alle ${users.length} User gewählt`
                    : `${users.length} User auf einmal`}
                </em>
              </span>
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

        <label className="folder-field">
          <span className="folder-field-label">Notiz (optional)</span>
          <textarea
            className="share-note-input"
            maxLength={280}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Kurzer Hinweis für die Empfänger"
            rows={2}
            value={note}
          />
        </label>

        {error && <p className="form-error">{error}</p>}
        {!error && !isLoading && users.length > 0 && selectedCount === 0 && (
          <p className="folder-hint">
            Wähle Empfänger oder Alle auswählen, dann teilen.
          </p>
        )}

        <button
          className="primary-button share-dialog-submit"
          disabled={
            isSaving ||
            isLoading ||
            selectedCount === 0 ||
            users.length === 0 ||
            (kind === 'folders' && selectedFolders.size === 0) ||
            (kind === 'folder' && !(folder || selectedFolders.size))
          }
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
