import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { fetchFolderMedia } from '../services/mediaApi.js'

const FOLDER_PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

export function ViewContent({ username, onLogout, onGoUpload, onGoCommunity }) {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
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

      <main className="app-page">
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

        <section className="media-section" aria-label="Inhalte">
          {error && <p className="form-error">{error}</p>}

          {!selectedFolder ? (
            <div className="empty-panel">
              <p>Ordner wählen.</p>
              <span>Danach die Inhalte über den Knopf laden.</span>
            </div>
          ) : hasLoaded && items.length === 0 ? (
            <div className="empty-panel">
              <p>Dieser Ordner ist noch leer.</p>
              <span>Lade Dateien über Upload hoch, dann erscheinen sie hier.</span>
            </div>
          ) : items.length > 0 ? (
            <div className="media-grid">
              {items.map((item) => (
                <MediaCard item={item} key={`${item.type}-${item.id}`} />
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <p>Noch nichts geladen.</p>
              <span>
                Mit dem Knopf werden die ersten {FOLDER_PAGE_SIZE} Dateien
                geladen, der Rest kommt beim Scrollen nach.
              </span>
            </div>
          )}

          {canLoadMore && <div aria-hidden="true" ref={sentinelRef} />}

          {selectedFolder && (!hasLoaded || hasMore) && (
            <div className="media-more">
              <button
                className="secondary-button media-load-button"
                disabled={isLoading}
                onClick={loadPage}
                type="button"
              >
                {isLoading
                  ? 'Lädt…'
                  : hasLoaded
                    ? `Nächste ${FOLDER_PAGE_SIZE}`
                    : `${FOLDER_PAGE_SIZE} laden`}
              </button>
              {hasLoaded && total !== null && (
                <span className="media-more-count">
                  {items.length} von {total}
                </span>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
