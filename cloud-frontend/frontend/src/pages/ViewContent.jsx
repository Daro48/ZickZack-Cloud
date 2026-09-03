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
  fetchTrashMedia,
  moveMediaItems,
  purgeMediaItems,
  renameFolder,
  renameMediaItem,
  restoreMediaItems,
} from '../services/mediaApi.js'

const FOLDER_PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'
const MOVE_CHUNK_SIZE = 8

const TYPE_OPTIONS = [
  { value: 'all', label: 'Alle' },
  { value: 'photo', label: 'Fotos' },
  { value: 'video', label: 'Videos' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Neueste Aufnahme' },
  { value: 'oldest', label: 'Älteste Aufnahme' },
  { value: 'name', label: 'Name' },
]

export function ViewContent({
  username,
  onLogout,
  onGoStart,
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
  const [trashMode, setTrashMode] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveFolders, setMoveFolders] = useState([])
  const [moveFolder, setMoveFolder] = useState('')
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveJob, setMoveJob] = useState(null)
  const loadIdRef = useRef(0)
  const isLoadingRef = useRef(false)
  const loadedCountRef = useRef(0)
  const sentinelRef = useRef(null)
  const moveBusyRef = useRef(false)

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
    setTrashMode(false)
    setSelectedFolder(folder)
    setShareNotice('')
  }

  function openTrash() {
    resetMedia()
    setTrashMode((current) => !current)
    setShareNotice('')
  }

  const loadPage = useCallback(async () => {
    if ((!trashMode && !selectedFolder) || isLoadingRef.current) {
      return
    }

    const requestId = loadIdRef.current
    isLoadingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const data = trashMode
        ? await fetchTrashMedia({
            offset: loadedCountRef.current,
            limit: FOLDER_PAGE_SIZE,
            query: debouncedQuery,
            type: typeFilter,
          })
        : await fetchFolderMedia(selectedFolder, {
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
  }, [debouncedQuery, selectedFolder, sort, trashMode, typeFilter])

  useEffect(() => {
    resetMedia()
  }, [debouncedQuery, sort, typeFilter, trashMode])

  const canLoadMore = hasLoaded && hasMore

  useEffect(() => {
    if ((!trashMode && !selectedFolder) || hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [selectedFolder, trashMode, hasLoaded, isLoading, loadPage])

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
      setMoveJob(null)
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
    setMoveJob({ phase: 'pick' })
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

  function applyMovedItems(toRemove) {
    if (!toRemove.length) {
      return
    }
    const removed = new Set(toRemove.map((item) => mediaKey(item)))
    setItems((current) => current.filter((item) => !removed.has(mediaKey(item))))
    setSelectedKeys((current) => {
      const next = new Set(current)
      for (const key of removed) {
        next.delete(key)
      }
      return next
    })
    setTotal((current) =>
      typeof current === 'number' ? Math.max(0, current - toRemove.length) : current,
    )
  }

  function failedItemKey(item) {
    return `${item.type}:${item.id}`
  }

  async function executeMoveItems(toMove, destination = moveFolder.trim()) {
    if (!toMove.length || !destination || moveBusyRef.current) {
      return
    }

    const originalTotal =
      moveJob?.phase === 'done' ? moveJob.originalTotal : toMove.length
    let movedCount = moveJob?.phase === 'done' ? moveJob.moved : 0
    const failedItems = []

    moveBusyRef.current = true
    setIsBusy(true)
    setError('')
    setViewerIndex(null)
    setMoveJob({
      phase: 'running',
      destination,
      originalTotal,
      batchTotal: toMove.length,
      processed: 0,
      moved: movedCount,
      failedItems: [],
    })

    try {
      for (let index = 0; index < toMove.length; index += MOVE_CHUNK_SIZE) {
        const chunk = toMove.slice(index, index + MOVE_CHUNK_SIZE)
        setMoveJob((current) =>
          current
            ? {
                ...current,
                processed: Math.min(index + chunk.length, toMove.length),
              }
            : current,
        )

        let failedLookup = new Map()
        try {
          const data = await moveMediaItems(chunk, destination)
          for (const failed of data.failed || []) {
            failedLookup.set(failedItemKey(failed), failed.message || '')
          }
        } catch (chunkError) {
          for (const item of chunk) {
            failedLookup.set(failedItemKey(item), chunkError.message)
          }
        }

        const succeeded = []
        for (const item of chunk) {
          const failMessage = failedLookup.get(failedItemKey(item))
          if (failMessage !== undefined) {
            failedItems.push({
              ...item,
              failMessage: failMessage || 'Datei konnte nicht verschoben werden.',
            })
          } else {
            succeeded.push(item)
          }
        }

        applyMovedItems(succeeded)
        movedCount += succeeded.length
        setMoveJob((current) =>
          current
            ? {
                ...current,
                moved: movedCount,
                failedItems: [...failedItems],
              }
            : current,
        )
      }

      const nextJob = {
        phase: 'done',
        destination,
        originalTotal,
        batchTotal: toMove.length,
        processed: toMove.length,
        moved: movedCount,
        failedItems,
      }
      setMoveJob(nextJob)
      if (failedItems.length === 0) {
        setShareNotice(
          movedCount === 1
            ? `1 Datei nach ${destination} verschoben.`
            : `${movedCount} Dateien nach ${destination} verschoben.`,
        )
      } else if (movedCount > 0) {
        setShareNotice(
          `${movedCount} verschoben, ${failedItems.length} fehlgeschlagen.`,
        )
      }
    } catch (moveError) {
      setError(moveError.message)
      setMoveJob((current) =>
        current
          ? {
              ...current,
              phase: 'done',
              processed: current.batchTotal,
              failedItems: failedItems.length ? failedItems : toMove,
            }
          : current,
      )
    } finally {
      moveBusyRef.current = false
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
    if (!selectedFolder || isBusy || trashMode) {
      return
    }
    setRenameValue(selectedFolder)
    setDialog({ type: 'rename' })
    setError('')
  }

  function handleRenameItems(toRename) {
    if (toRename.length !== 1 || isBusy || trashMode) {
      return
    }
    setRenameValue(toRename[0].original_name || '')
    setDialog({ type: 'rename-file', item: toRename[0] })
    setError('')
  }

  async function executeRenameFile() {
    const nextName = renameValue.trim()
    const item = dialog?.item
    if (!item || !nextName || isBusy) {
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const data = await renameMediaItem(item, nextName)
      const name = data.original_name || nextName
      setItems((current) =>
        current.map((entry) =>
          mediaKey(entry) === mediaKey(item)
            ? { ...entry, original_name: name }
            : entry,
        ),
      )
      setShareNotice(`„${name}“ umbenannt.`)
      setDialog(null)
    } catch (renameError) {
      setError(renameError.message)
    } finally {
      setIsBusy(false)
    }
  }

  function handleRestoreItems(toRestore) {
    if (!toRestore.length || isBusy) {
      return
    }
    setDialog({ type: 'restore-items', items: toRestore })
    setError('')
  }

  async function executeRestoreItems(toRestore) {
    setIsBusy(true)
    setError('')
    try {
      await restoreMediaItems(toRestore)
      const removed = new Set(toRestore.map((item) => mediaKey(item)))
      setItems((current) => current.filter((item) => !removed.has(mediaKey(item))))
      setSelectedKeys(new Set())
      setTotal((current) =>
        typeof current === 'number' ? Math.max(0, current - toRestore.length) : current,
      )
      setViewerIndex(null)
      setShareNotice(
        toRestore.length === 1
          ? '1 Datei wiederhergestellt.'
          : `${toRestore.length} Dateien wiederhergestellt.`,
      )
      setDialog(null)
    } catch (restoreError) {
      setError(restoreError.message)
    } finally {
      setIsBusy(false)
    }
  }

  function handlePurgeItems(toPurge, empty = false) {
    if ((!empty && !toPurge.length) || isBusy) {
      return
    }
    setDialog({ type: 'purge-items', items: toPurge, empty })
    setError('')
  }

  async function executePurgeItems(dialogState) {
    setIsBusy(true)
    setError('')
    try {
      const data = await purgeMediaItems(dialogState.items || [], {
        empty: Boolean(dialogState.empty),
      })
      if (dialogState.empty) {
        setItems([])
        setTotal(0)
        setHasMore(false)
      } else {
        const removed = new Set(dialogState.items.map((item) => mediaKey(item)))
        setItems((current) => current.filter((item) => !removed.has(mediaKey(item))))
        setTotal((current) =>
          typeof current === 'number'
            ? Math.max(0, current - dialogState.items.length)
            : current,
        )
      }
      setSelectedKeys(new Set())
      setViewerIndex(null)
      const deleted = typeof data.deleted === 'number' ? data.deleted : 0
      setShareNotice(
        deleted === 1
          ? '1 Datei endgültig gelöscht.'
          : `${deleted} Dateien endgültig gelöscht.`,
      )
      setDialog(null)
    } catch (purgeError) {
      setError(purgeError.message)
    } finally {
      setIsBusy(false)
    }
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
        onGoHome={onGoStart}
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

        <div className="content-folder-row">
          <FolderPicker
            allowCreate={false}
            folder={selectedFolder}
            onFolderChange={handleFolderChange}
            refreshKey={folderRefreshKey}
            username={username}
          />
          <button
            aria-pressed={trashMode}
            className={`secondary-button${trashMode ? ' is-active' : ''}`}
            onClick={openTrash}
            type="button"
          >
            Papierkorb
          </button>
        </div>

        {(selectedFolder || trashMode) && (
          <section className="media-toolbar" aria-label="Ordner und Filter">
            <div className="media-toolbar-row is-actions">
              {trashMode ? (
                <>
                  <button
                    className="danger-button"
                    disabled={isBusy || items.length === 0}
                    onClick={() => handlePurgeItems(items, true)}
                    type="button"
                  >
                    Papierkorb leeren
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
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
              {!trashMode && (
                <SelectMenu
                  accent
                  label="Sortierung"
                  onChange={setSort}
                  options={SORT_OPTIONS}
                  value={sort}
                />
              )}
            </div>
          </section>
        )}

        {shareNotice && <p className="upload-ok share-notice">{shareNotice}</p>}
        {trashMode && (
          <p className="folder-hint">
            Dateien bleiben 30 Tage im Papierkorb und werden danach endgültig
            gelöscht.
          </p>
        )}

        <section className="media-section" aria-label="Inhalte">
          {error && <p className="form-error">{error}</p>}

          {!trashMode && !selectedFolder ? (
            <div className="empty-panel">
              <p>Ordner wählen.</p>
              <span>Danach erscheinen die Fotos und Videos hier.</span>
            </div>
          ) : hasLoaded && items.length === 0 ? (
            <div className="empty-panel">
              <p>{trashMode ? 'Papierkorb ist leer.' : 'Nichts gefunden.'}</p>
              <span>
                {trashMode
                  ? 'Gelöschte Dateien erscheinen hier für 30 Tage.'
                  : debouncedQuery || typeFilter !== 'all'
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
        deleteLabel={
          trashMode
            ? selectedItems.length === 1
              ? 'Endgültig löschen'
              : `${selectedItems.length} endgültig löschen`
            : undefined
        }
        onClear={clearSelection}
        onDelete={
          trashMode
            ? () => handlePurgeItems(selectedItems)
            : () => handleDeleteItems(selectedItems)
        }
        onMove={trashMode ? undefined : () => handleMoveItems(selectedItems)}
        onRename={
          trashMode || selectedItems.length !== 1
            ? undefined
            : () => handleRenameItems(selectedItems)
        }
        onRestore={
          trashMode ? () => handleRestoreItems(selectedItems) : undefined
        }
        onSelectAll={items.length > 0 ? selectAllVisible : undefined}
        onShare={
          trashMode
            ? undefined
            : () => setShareTarget({ kind: 'items', items: selectedItems })
        }
      />

      {viewerIndex !== null && items[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={items}
          onClose={closeViewer}
          onDelete={
            trashMode
              ? (item) => handlePurgeItems([item])
              : (item) => handleDeleteItems([item])
          }
          deleteLabel={trashMode ? 'Endgültig löschen' : undefined}
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
          busy={moveJob?.phase === 'running'}
          busyLabel="Wird verschoben…"
          cancelLabel={moveJob?.phase === 'done' ? 'Schließen' : 'Abbrechen'}
          confirmDisabled={
            moveJob?.phase === 'running' ||
            (moveJob?.phase !== 'done' && (moveLoading || !moveFolder))
          }
          confirmLabel={
            moveJob?.phase === 'done'
              ? moveJob.failedItems.length > 0
                ? 'Fehler erneut versuchen'
                : 'Schließen'
              : dialog.items.length === 1
                ? 'Datei verschieben'
                : `${dialog.items.length} Dateien verschieben`
          }
          description={
            moveJob?.phase === 'running'
              ? `Dateien werden nach „${moveJob.destination}“ verschoben.`
              : moveJob?.phase === 'done'
                ? moveJob.failedItems.length === 0
                  ? `Alle Dateien sind in „${moveJob.destination}“.`
                  : moveJob.moved === 0
                    ? `Keine Datei nach „${moveJob.destination}“ verschoben.`
                    : `${moveJob.moved} von ${moveJob.originalTotal} Dateien nach „${moveJob.destination}“ verschoben.`
                : dialog.items.length === 1
                  ? `„${dialog.items[0].original_name}“ wird aus „${selectedFolder}“ in den gewählten Ordner verschoben.`
                  : `${dialog.items.length} Dateien werden aus „${selectedFolder}“ in den gewählten Ordner verschoben.`
          }
          error={moveJob?.phase === 'pick' ? error : ''}
          hideCancel={moveJob?.phase === 'done' && moveJob.failedItems.length === 0}
          onCancel={closeDialog}
          onConfirm={() => {
            if (moveJob?.phase === 'done' && moveJob.failedItems.length === 0) {
              closeDialog()
              return
            }
            if (moveJob?.phase === 'done' && moveJob.failedItems.length > 0) {
              executeMoveItems(moveJob.failedItems, moveJob.destination)
              return
            }
            executeMoveItems(dialog.items)
          }}
          title={
            moveJob?.phase === 'running'
              ? 'Dateien werden verschoben'
              : moveJob?.phase === 'done'
                ? 'Verschieben abgeschlossen'
                : 'In Ordner verschieben'
          }
        >
          {moveJob?.phase === 'running' && (
            <div aria-live="polite" className="move-progress">
              <div
                aria-valuemax={moveJob.batchTotal}
                aria-valuemin={0}
                aria-valuenow={moveJob.processed}
                className="upload-progress"
                role="progressbar"
              >
                <div
                  className="upload-progress-bar"
                  style={{
                    width: `${
                      moveJob.batchTotal
                        ? Math.round(
                            (moveJob.processed / moveJob.batchTotal) * 100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="folder-hint">
                {moveJob.processed} von {moveJob.batchTotal} Dateien
                {moveJob.failedItems.length > 0
                  ? ` · ${moveJob.failedItems.length} fehlgeschlagen`
                  : ''}
              </p>
            </div>
          )}
          {moveJob?.phase === 'done' && moveJob.failedItems.length === 0 && (
            <p className="upload-ok">
              {moveJob.moved === 1
                ? '1 Datei wurde verschoben.'
                : `Alle ${moveJob.moved} Dateien wurden verschoben.`}
            </p>
          )}
          {moveJob?.phase === 'done' && moveJob.failedItems.length > 0 && (
            <p className="form-error">
              {moveJob.failedItems.length === 1
                ? '1 Datei fehlgeschlagen. Du kannst den Fehler erneut versuchen.'
                : `${moveJob.failedItems.length} Dateien fehlgeschlagen. Du kannst die Fehler erneut versuchen.`}
            </p>
          )}
          {moveJob?.phase === 'pick' &&
            (moveLoading ? (
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
            ))}
        </ConfirmDialog>
      )}
      {dialog?.type === 'delete-items' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={
            dialog.items.length === 1 ? 'In den Papierkorb' : `${dialog.items.length} in den Papierkorb`
          }
          danger
          description={
            dialog.items.length === 1
              ? `„${dialog.items[0].original_name}“ wird in den Papierkorb gelegt und nach 30 Tagen endgültig gelöscht.`
              : `${dialog.items.length} Dateien werden in den Papierkorb gelegt und nach 30 Tagen endgültig gelöscht.`
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
          description={`Dateien in „${selectedFolder}“ werden in den Papierkorb gelegt und nach 30 Tagen endgültig gelöscht. Der leere Ordner bleibt erhalten, solange noch Dateien im Papierkorb liegen.`}
          error={error}
          onCancel={closeDialog}
          onConfirm={executeDeleteFolder}
          title="Ordner löschen"
        />
      )}

      {dialog?.type === 'rename-file' && (
        <ConfirmDialog
          busy={isBusy}
          confirmDisabled={!renameValue.trim()}
          confirmLabel="Datei umbenennen"
          description="Nur der angezeigte Name ändert sich. Die Datei selbst bleibt am selben Ort."
          error={error}
          onCancel={closeDialog}
          onConfirm={executeRenameFile}
          title="Datei umbenennen"
        >
          <label className="folder-field">
            <span className="folder-field-label">Neuer Name</span>
            <input
              autoFocus
              maxLength={255}
              onChange={(event) => setRenameValue(event.target.value)}
              value={renameValue}
            />
          </label>
        </ConfirmDialog>
      )}

      {dialog?.type === 'restore-items' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={
            dialog.items.length === 1
              ? 'Datei wiederherstellen'
              : `${dialog.items.length} Dateien wiederherstellen`
          }
          description={
            dialog.items.length === 1
              ? `„${dialog.items[0].original_name}“ kommt zurück in den Ordner „${dialog.items[0].folder || 'Unbekannt'}“.`
              : `${dialog.items.length} Dateien kommen zurück in ihre ursprünglichen Ordner.`
          }
          error={error}
          onCancel={closeDialog}
          onConfirm={() => executeRestoreItems(dialog.items)}
          title="Wiederherstellen"
        />
      )}

      {dialog?.type === 'purge-items' && (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={
            dialog.empty
              ? 'Papierkorb leeren'
              : dialog.items.length === 1
                ? 'Endgültig löschen'
                : `${dialog.items.length} endgültig löschen`
          }
          danger
          description={
            dialog.empty
              ? 'Alle Dateien im Papierkorb werden dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.'
              : dialog.items.length === 1
                ? `„${dialog.items[0].original_name}“ wird dauerhaft entfernt und kann nicht wiederhergestellt werden.`
                : `${dialog.items.length} Dateien werden dauerhaft entfernt und können nicht wiederhergestellt werden.`
          }
          error={error}
          onCancel={closeDialog}
          onConfirm={() => executePurgeItems(dialog)}
          title={dialog.empty ? 'Papierkorb leeren' : 'Endgültig löschen'}
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
