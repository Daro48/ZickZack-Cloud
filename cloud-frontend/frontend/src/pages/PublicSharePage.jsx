import { useCallback, useEffect, useRef, useState } from 'react'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { fetchPublicShare, fetchPublicShareMedia } from '../services/communityApi.js'
import { mediaKey } from '../services/communityApi.js'

const PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

export function PublicSharePage({ token, onGoLogin }) {
  const [share, setShare] = useState(null)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)
  const loadIdRef = useRef(0)
  const loadingRef = useRef(false)
  const countRef = useRef(0)
  const sentinelRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function loadShare() {
      setError('')
      try {
        const data = await fetchPublicShare(token)
        if (!cancelled) {
          setShare(data.share || null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setShare(null)
          setError(loadError.message)
        }
      }
    }
    loadShare()
    return () => {
      cancelled = true
    }
  }, [token])

  const loadPage = useCallback(async () => {
    if (!token || loadingRef.current) {
      return
    }
    const requestId = loadIdRef.current
    loadingRef.current = true
    setIsLoading(true)
    try {
      const data = await fetchPublicShareMedia(token, {
        offset: countRef.current,
        limit: PAGE_SIZE,
      })
      if (requestId !== loadIdRef.current) {
        return
      }
      const nextItems = data.items || []
      countRef.current += nextItems.length
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
      loadingRef.current = false
    }
  }, [token])

  useEffect(() => {
    loadIdRef.current += 1
    loadingRef.current = false
    countRef.current = 0
    setItems([])
    setTotal(null)
    setHasMore(false)
    setHasLoaded(false)
    setViewerIndex(null)
  }, [token])

  useEffect(() => {
    if (!share || hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [share, hasLoaded, isLoading, loadPage])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasLoaded || !hasMore) {
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
  }, [hasLoaded, hasMore, loadPage])

  const title =
    share?.kind === 'folder' ? share.folder : `${share?.item_count || 0} Datei(en)`

  return (
    <div className="app-shell">
      <Topbar />
      <main className="app-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Öffentliche Freigabe</p>
            <h1>{share ? title : 'Freigabe'}</h1>
          </div>
        </header>

        {share?.note && <p className="share-note">{share.note}</p>}
        {share && (
          <p className="folder-hint">
            Von {share.owner?.username}
            {total !== null ? ` · ${total} Datei(en)` : ''}
            {share.public_link?.expires_at
              ? ` · gültig bis ${share.public_link.expires_at}`
              : ''}
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        {!error && !share ? (
          <div className="empty-panel">
            <p>Lädt…</p>
            <span>Die Freigabe wird geladen.</span>
          </div>
        ) : hasLoaded && items.length === 0 ? (
          <div className="empty-panel">
            <p>Keine Dateien</p>
            <span>In dieser Freigabe liegt gerade nichts.</span>
          </div>
        ) : items.length > 0 ? (
          <section className="media-section">
            <div className="media-grid">
              {items.map((item, index) => (
                <MediaCard
                  item={item}
                  key={mediaKey(item)}
                  onOpen={() => setViewerIndex(index)}
                />
              ))}
            </div>
            {hasLoaded && hasMore && <div aria-hidden="true" ref={sentinelRef} />}
            {(isLoading || total !== null) && (
              <div className="media-more">
                {isLoading && (
                  <span className="media-more-status">Lädt weitere Dateien…</span>
                )}
                {total !== null && (
                  <span className="media-more-count">
                    {items.length} von {total}
                  </span>
                )}
              </div>
            )}
          </section>
        ) : null}

        {onGoLogin && (
          <p className="switch-copy">
            Eigenes Konto?
            <button type="button" onClick={onGoLogin}>
              Anmelden
            </button>
          </p>
        )}
      </main>

      {viewerIndex !== null && items[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={items}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
        />
      )}
    </div>
  )
}
