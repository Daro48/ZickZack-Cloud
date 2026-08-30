import { useEffect, useRef, useState } from 'react'
import { createFolder, fetchFolders } from '../services/mediaApi.js'

export function FolderPicker({
  disabled = false,
  folder,
  onFolderChange,
  username,
}) {
  const [folders, setFolders] = useState([])
  const [newFolder, setNewFolder] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadFolders() {
      setIsLoading(true)
      setError('')
      try {
        const data = await fetchFolders()
        if (cancelled) {
          return
        }
        const nextFolders = data.folders || []
        setFolders(nextFolders)
        if (!folder && nextFolders.length > 0) {
          onFolderChange(nextFolders[0])
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

    loadFolders()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  async function handleCreateFolder(event) {
    event.preventDefault()
    const name = newFolder.trim()
    if (!name || disabled || isCreating) {
      return
    }

    setIsCreating(true)
    setError('')
    try {
      const data = await createFolder(name)
      const nextFolders = data.folders || []
      setFolders(nextFolders)
      onFolderChange(data.folder || name)
      setNewFolder('')
      setIsOpen(false)
    } catch (createError) {
      setError(createError.message)
    } finally {
      setIsCreating(false)
    }
  }

  function handleSelectFolder(name) {
    onFolderChange(name)
    setIsOpen(false)
  }

  const selectDisabled = disabled || isLoading || folders.length === 0
  const displayValue = isLoading
    ? 'Lädt…'
    : folder || (folders.length === 0 ? 'Noch kein Ordner' : 'Ordner wählen')
  const userLabel = String(username || '').toUpperCase()
  const pathLabel = folder ? `${userLabel} / ${folder}` : userLabel

  return (
    <section className="folder-picker" aria-label="Ordner" ref={rootRef}>
      {pathLabel && <p className="folder-picker-path">{pathLabel}</p>}

      <div className="folder-picker-row">
        <div className="folder-field">
          <span className="folder-field-label">Vorhandener Ordner</span>
          <button
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            className={`folder-select-trigger${isOpen ? ' is-open' : ''}${
              folder ? ' has-value' : ''
            }`}
            disabled={selectDisabled}
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            <span className="folder-select-value">{displayValue}</span>
            <span aria-hidden="true" className="folder-select-caret" />
          </button>

          {isOpen && folders.length > 0 && (
            <div
              className="folder-select-panel"
              role="listbox"
              aria-label="Ordner wählen"
            >
              {folders.map((entry) => (
                <button
                  className={`folder-select-option${
                    folder === entry ? ' is-active' : ''
                  }`}
                  key={entry}
                  onClick={() => handleSelectFolder(entry)}
                  role="option"
                  aria-selected={folder === entry}
                  type="button"
                >
                  {entry}
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="folder-create" onSubmit={handleCreateFolder}>
          <label className="folder-field">
            <span className="folder-field-label">Neuen Ordner erstellen</span>
            <input
              disabled={disabled || isCreating}
              maxLength={64}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder="z.B. Urlaub"
              type="text"
              value={newFolder}
            />
          </label>
          <button
            className="secondary-button"
            disabled={disabled || isCreating || !newFolder.trim()}
            type="submit"
          >
            {isCreating ? 'Wird erstellt…' : 'Erstellen'}
          </button>
        </form>
      </div>

      {isLoading && <p className="folder-hint">Ordner werden geladen…</p>}
      {!isLoading && !folder && (
        <p className="folder-hint">
          Erstelle zuerst einen Ordner. Fotos und Videos werden dort unter {String(username || '').toUpperCase()} gespeichert.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
