import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { SelectionPopup } from '../components/SelectionPopup.jsx'
import { ShareDialog } from '../components/ShareDialog.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { mediaKey } from '../services/communityApi.js'
import { fetchFolderMedia } from '../services/mediaApi.js'

const FOLDER_PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

export function ViewContent({
  username,
  onLogout,
  onGoHome,
  onGoUpload,
  onGoCommunity,
}) {
  const [selectedFolder, setSelectedFolder] = useState('')
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
  const loadIdRef = useRef(0)
  const isLoadingRef = useRef(false)
  const loadedCountRef = useRef(0)
  const sentinelRef = useRef(null)

  function handleFolderChange(folder) {
    loadIdRef.current += 1
    isLoadingRef.current = false
    loadedCountRef.current = 0
    setSelectedFolder(folder)
    setItems([])
    setTotal(null)
    setHasMore(false)
    setHasLoaded(false)
    setError('')
    setIsLoading(false)
    setViewerIndex(null)
    setSelectedKeys(new Set())
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
  }, [selectedFolder])

  const canLoadMore = hasLoaded && hasMore

  useEffect(() => {
    if (!selectedFolder || hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [selectedFolder])

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
    const count = shareTarget?.kind === 'folder' ? 0 : selectedItems.length
    setShareTarget(null)
    setSelectedKeys(new Set())
    setShareNotice(
      shareTarget?.kind === 'folder'
        ? `Ordner ${selectedFolder} ist geteilt.`
        : `${count === 1 ? '1 Datei' : `${count} Dateien`} geteilt.`,
    )
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(items.map((item) => mediaKey(item))))
  }

  function clearSelection() {
    setSelectedKeys(new Set())
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
        center={
          <nav className="topbar-nav" aria-label="Hauptnavigation">
            <button
              className="nav-link"
              onClick={onGoUpload}
              type="button"
            >
              Upload
            </button>
            <button className="nav-link is-active" type="button">
              Inhalte
            </button>
            <button
              className="nav-link"
              onClick={onGoCommunity}
              type="button"
            >
              Community
            </button>
          </nav>
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
          username={username}
        />

        {selectedFolder && (
          <section className="community-actions" aria-label="Teilen">
            <button
              className="secondary-button"
              onClick={() =>
                setShareTarget({ kind: 'folder', folder: selectedFolder })
              }
              type="button"
            >
              Ganzen Ordner teilen
            </button>
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
              <p>Dieser Ordner ist noch leer.</p>
              <span>Lade Dateien über Upload hoch, dann erscheinen sie hier.</span>
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
    </div>
  )
}
