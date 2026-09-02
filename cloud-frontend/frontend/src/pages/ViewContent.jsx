import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { SelectMenu } from '../components/SelectMenu.jsx'
import { SelectionPopup } from '../components/SelectionPopup.jsx'
import { ShareDialog } from '../components/ShareDialog.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { mediaKey } from '../services/communityApi.js'
import {
  deleteFolder,
  deleteMediaItems,
  fetchFolderMedia,
  fetchFolders,
  moveMediaItems,
  renameFolder,
} from '../services/mediaApi.js'

const FOLDER_PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

const TYPE_OPTIONS = [
  { value: 'all', label: 'Alle' },
  { value: 'photo', label: 'Fotos' },
  { value: 'video', label: 'Videos' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Neueste' },
  { value: 'oldest', label: 'Älteste' },
  { value: 'name', label: 'Name' },
]

export function ViewContent({
  username,
  onLogout,
  onGoHome,
  onGoUpload,
  onGoCommunity,
}) {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [shareTarget, setShareTarget] = useState(null)
  const [shareNotice, setShareNotice] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveFolders, setMoveFolders] = useState([])
  const [moveFolder, setMoveFolder] = useState('')
  const [moveLoading, setMoveLoading] = useState(false)
  const loadIdRef = useRef(0)
  const isLoadingRef = useRef(false)
  const loadedCountRef = useRef(0)
  const sentinelRef = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  function resetMedia() {
    loadIdRef.current += 1
    isLoadingRef.current = false
    loadedCountRef.current = 0
    setItems([])
    setTotal(null)
    setHasMore(false)
    setHasLoaded(false)
    setError('')
    setIsLoading(false)
    setViewerIndex(null)
    setSelectedKeys(new Set())
  }

  function handleFolderChange(folder) {
    resetMedia()
    setSelectedFolder(folder)
    setShareNotice('')
  }

  const loadPage = useCallback(async () => {
    if (!selectedFolder || isLoadingRef.current) {
      return
    }

    const requestId = loadIdRef.current
    isLoadingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const data = await fetchFolderMedia(selectedFolder, {
        offset: loadedCountRef.current,
        limit: FOLDER_PAGE_SIZE,
        query: debouncedQuery,
        type: typeFilter,
        sort,
      })
      if (requestId !== loadIdRef.current) {
        return
      }

      const nextItems = data.items || []
      loadedCountRef.current += nextItems.length
      setItems((current) => (nextItems.length ? [...current, ...nextItems] : current))
      setHasMore(Boolean(data.has_more))
      setHasLoaded(true)
      if (typeof data.total === 'number') {
        setTotal(data.total)
      }
    } catch (loadError) {
      if (requestId === loadIdRef.current) {
        setError(loadError.message)
      }
    } finally {
      if (requestId === loadIdRef.current) {
        setIsLoading(false)
      }
      isLoadingRef.current = false
    }
  }, [debouncedQuery, selectedFolder, sort, typeFilter])

  useEffect(() => {
    resetMedia()
  }, [debouncedQuery, sort, typeFilter])

  const canLoadMore = hasLoaded && hasMore

  useEffect(() => {
    if (!selectedFolder || hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [selectedFolder, hasLoaded, isLoading, loadPage])

  const closeViewer = useCallback(() => {
    setViewerIndex(null)
  }, [])

  const closeShareDialog = useCallback(() => {
    setShareTarget(null)
  }, [])

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(mediaKey(item))),
    [items, selectedKeys],
  )

  function toggleSelect(item) {
    const key = mediaKey(item)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function handleShared() {
    setShareTarget(null)
    setSelectedKeys(new Set())
    setShareNotice(
      shareTarget?.kind === 'folder' || shareTarget?.kind === 'folders'
        ? 'Ordner geteilt.'
        : `${selectedItems.length === 1 ? '1 Datei' : `${selectedItems.length} Dateien`} geteilt.`,
    )
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(items.map((item) => mediaKey(item))))
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  const closeDialog = useCallback(() => {
    if (!isBusy) {
      setDialog(null)
    }
  }, [isBusy])

  async function handleDeleteItems(toDelete) {
    if (!toDelete.length || isBusy) {
      return
    }
    setDialog({ type: 'delete-items', items: toDelete })
    setError('')
  }

  async function handleMoveItems(toMove) {
    if (!toMove.length || isBusy) {
      return
    }
    setMoveFolder('')
    setMoveFolders([])
    setDialog({ type: 'move-items', items: toMove })
    setError('')
    setMoveLoading(true)
    try {
      const data = await fetchFolders()
      setMoveFolders(
        (data.folders || []).filter((name) => name !== selectedFolder),
      )
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setMoveLoading(false)
    }
  }

  async function executeMoveItems(toMove) {
    const destination = moveFolder.trim()
    if (!destination || isBusy) {
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const data = await moveMediaItems(toMove, destination)
      const removed = new Set(toMove.map((item) => mediaKey(item)))
      setItems((current) => current.filter((item) => !removed.has(mediaKey(item))))
      setSelectedKeys((current) => {
        const next = new Set(current)
        for (const key of removed) {
          next.delete(key)
        }
        return next
      })
      const moved = typeof data.moved === 'number' ? data.moved : toMove.length
      setTotal((current) =>
        typeof current === 'number' ? Math.max(0, current - moved) : current,
      )
      setViewerIndex(null)
      setShareNotice(
        moved === 1
          ? `1 Datei nach ${destination} verschoben.`
          : `${moved} Dateien nach ${destination} verschoben.`,
      )
      setDialog(null)
    } catch (moveError) {
      setError(moveError.message)
    } finally {
      setIsBusy(false)
    }
  }

  async function executeDeleteItems(toDelete) {
    setIsBusy(true)
    setError('')
    try {
      await deleteMediaItems(toDelete)
      const removed = new Set(toDelete.map((item) => mediaKey(item)))
      setItems((current) => current.filter((item) => !removed.has(mediaKey(item))))
      setSelectedKeys((current) => {
        const next = new Set(current)
        for (const key of removed) {
          next.delete(key)
        }
        return next
      })
      setTotal((current) =>
        typeof current === 'number' ? Math.max(0, current - toDelete.length) : current,
      )
      setViewerIndex(null)
      setDialog(null)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setIsBusy(false)
    }
  }

  function handleRenameFolder() {
    if (!selectedFolder || isBusy) {
      return
    }
    setRenameValue(selectedFolder)
    setDialog({ type: 'rename' })
    setError('')
  }

  async function executeRenameFolder() {
    const nextName = renameValue.trim()
    if (!nextName || nextName === selectedFolder) {
      setDialog(null)
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const data = await renameFolder(selectedFolder, nextName)
      setSelectedFolder(data.folder || nextName)
      setFolderRefreshKey((current) => current + 1)
      setShareNotice(`Ordner heißt jetzt ${data.folder || nextName}.`)
      setDialog(null)
    } catch (renameError) {
      setError(renameError.message)
    } finally {
      setIsBusy(false)
    }
  }

  function handleDeleteFolder() {
    if (!selectedFolder || isBusy) {
      return
    }
    setDialog({ type: 'delete-folder' })
    setError('')
  }

  async function executeDeleteFolder() {
    setIsBusy(true)
    setError('')
    try {
      await deleteFolder(selectedFolder)
      resetMedia()
      setSelectedFolder('')
      setFolderRefreshKey((current) => current + 1)
      setShareNotice('Ordner gelöscht.')
      setDialog(null)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setIsBusy(false)
    }
  }

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !canLoadMore) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadPage()
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    )
    observer.observe(node)

    return () => observer.disconnect()
  }, [canLoadMore, loadPage])

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        onGoHome={onGoHome}
        onGoCommunity={onGoCommunity}
        center={
          <AppNav
            current="content"
            onNavigate={(page) => {
              if (page === 'home') onGoUpload()
              if (page === 'community') onGoCommunity()
            }}
          />
        }
        action={
          <button className="secondary-button" type="button" onClick={onLogout}>
            Abmelden
          </button>
        }
      />

      <main className={`app-page${selectedItems.length > 0 ? ' has-selection-popup' : ''}`}>
        <header className="page-header">
          <div>
            <p className="eyebrow">Cloud</p>
            <h1>Inhalte</h1>
          </div>
        </header>

        <FolderPicker
          allowCreate={false}
          folder={selectedFolder}
          onFolderChange={handleFolderChange}
          refreshKey={folderRefreshKey}
          username={username}
        />

        {selectedFolder && (
          <section className="media-toolbar" aria-label="Ordner und Filter">
            <div className="media-toolbar-row is-actions">
              <button
                className="ghost-button"
                disabled={isBusy}
                onClick={handleRenameFolder}
                type="button"
              >
                Ordner umbenennen
              </button>
              <button
                className="danger-button"
                disabled={isBusy}
                onClick={handleDeleteFolder}
                type="button"
              >
                Ordner löschen
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  setShareTarget({ kind: 'folder', folder: selectedFolder })
                }
                type="button"
              >
                Ganzen Ordner teilen
              </button>
            </div>
            <div className="media-toolbar-row is-filters">
              <label className="folder-field media-search">
                <span className="folder-field-label">Suche</span>
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name"
                  type="search"
                  value={query}
                />
              </label>
              <SelectMenu
                accent
                label="Typ"
                onChange={setTypeFilter}
                options={TYPE_OPTIONS}
                value={typeFilter}
              />
              <SelectMenu
                accent
                label="Sortierung"
                onChange={setSort}
                options={SORT_OPTIONS}
                value={sort}
              />
            </div>
          </section>
        )}

        {shareNotice && <p className="upload-ok share-notice">{shareNotice}</p>}

        <section className="media-section" aria-label="Inhalte">
          {error && <p className="form-error">{error}</p>}

          {!selectedFolder ? (
            <div className="empty-panel">
              <p>Ordner wählen.</p>
              <span>Danach erscheinen die Fotos und Videos hier.</span>
            </div>
          ) : hasLoaded && items.length === 0 ? (
            <div className="empty-panel">
              <p>Nichts gefunden.</p>
              <span>
                {debouncedQuery || typeFilter !== 'all'
                  ? 'Passe Suche oder Filter an.'
                  : 'Lade Dateien über Upload hoch, dann erscheinen sie hier.'}
              </span>
            </div>
          ) : items.length > 0 ? (
            <div className="media-grid">
              {items.map((item, index) => (
                <MediaCard
                  item={item}
                  key={mediaKey(item)}
                  onOpen={() => setViewerIndex(index)}
                  onToggleSelect={() => toggleSelect(item)}
                  selectable
                  selected={selectedKeys.has(mediaKey(item))}
                />
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <p>Lädt…</p>
              <span>Die ersten Dateien werden geladen.</span>
            </div>
          )}

          {canLoadMore && <div aria-hidden="true" ref={sentinelRef} />}

          {(isLoading || (hasLoaded && total !== null)) && (
            <div className="media-more">
              {isLoading && (
                <span className="media-more-status">Lädt weitere Dateien…</span>
              )}
              {hasLoaded && total !== null && (
                <span className="media-more-count">
                  {items.length} von {total}
                </span>
              )}
              {error && !isLoading && (
                <button
                  className="ghost-button media-load-button"
                  onClick={loadPage}
                  type="button"
                >
                  Erneut laden
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      <SelectionPopup
        count={selectedItems.length}
        onClear={clearSelection}
        onDelete={() => handleDeleteItems(selectedItems)}
        onMove={() => handleMoveItems(selectedItems)}
        onSelectAll={items.length > 0 ? selectAllVisible : undefined}
        onShare={() =>
          setShareTarget({ kind: 'items', items: selectedItems })
        }
      />

      {viewerIndex !== null && items[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={items}
          onClose={closeViewer}
          onDelete={(item) => handleDeleteItems([item])}
          onIndexChange={setViewerIndex}
        />
      )}

      {shareTarget && (
        <ShareDialog
          folder={shareTarget.folder}
          items={shareTarget.items}
          kind={shareTarget.kind}
          onClose={closeShareDialog}
          onShared={handleShared}
        />
      )}

      {dialog?.type === 'move-items' && (
        <ConfirmDialog
          busy={isBusy}
          confirmDisabled={moveLoading || !moveFolder}
          confirmLabel={
            dialog.items.length === 1
              ? 'Datei verschieben'
              : `${dialog.items.length} Dateien verschieben`
          }
          description={
            dialog.items.length === 1
              ? `„${dialog.items[0].original_name}“ wird aus „${selectedFolder}“ in den gewählten Ordner verschoben.`
              : `${dialog.items.length} Dateien werden aus „${selectedFolder}“ in den gewählten Ordner verschoben.`
          }
          error={error}
          onCancel={closeDialog}
          onConfirm={() => executeMoveItems(dialog.items)}
          title="In Ordner verschieben"
        >
          {moveLoading ? (
            <p className="folder-hint">Ordner werden geladen…</p>
          ) : moveFolders.length === 0 ? (
            <div className="empty-panel">
              <p>Kein anderer Ordner.</p>
              <span>
                Lege unter Upload zuerst einen Zielordner an, zum Beispiel
                Urlaub 2024.
              </span>
            </div>
          ) : (
            <div
              aria-label="Zielordner"
              className="share-user-list is-compact"
              role="group"
            >
              {moveFolders.map((name) => {
                const isActive = moveFolder === name
                return (
                  <button
                    aria-pressed={isActive}
                    className={`share-user-option${isActive ? ' is-active' : ''}`}
                    key={name}
                    onClick={() => setMoveFolder(name)}
                    type="button"
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          )}
        </ConfirmDialog>
      )}
      {dialog?.type === 'delete-items' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={
            dialog.items.length === 1 ? 'Datei löschen' : `${dialog.items.length} Dateien löschen`
          }
          danger
          description={
            dialog.items.length === 1
              ? `„${dialog.items[0].original_name}“ wird dauerhaft entfernt und kann nicht wiederhergestellt werden.`
              : `${dialog.items.length} Dateien werden dauerhaft entfernt und können nicht wiederhergestellt werden.`
          }
          error={error}
          onCancel={closeDialog}
          onConfirm={() => executeDeleteItems(dialog.items)}
          title={dialog.items.length === 1 ? 'Datei löschen' : 'Dateien löschen'}
        />
      )}

      {dialog?.type === 'delete-folder' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel="Ordner löschen"
          danger
          description={`Ordner „${selectedFolder}“ und alle Dateien darin werden dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.`}
          error={error}
          onCancel={closeDialog}
          onConfirm={executeDeleteFolder}
          title="Ordner löschen"
        />
      )}

      {dialog?.type === 'rename' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel="Ordner umbenennen"
          description="Der Name gilt für den Ordner bei dir. Freigaben dieses Ordners werden mitgeführt."
          error={error}
          onCancel={closeDialog}
          onConfirm={executeRenameFolder}
          title="Ordner umbenennen"
        >
          <label className="folder-field">
            <span className="folder-field-label">Neuer Name</span>
            <input
              autoFocus
              maxLength={64}
              onChange={(event) => setRenameValue(event.target.value)}
              value={renameValue}
            />
          </label>
        </ConfirmDialog>
      )}
    </div>
  )
}
