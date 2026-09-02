import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { SelectMenu } from '../components/SelectMenu.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { mediaKey } from '../services/communityApi.js'
import { fetchTimelineMedia } from '../services/mediaApi.js'
import { formatDayHeading } from '../utils/format.js'

const PAGE_SIZE = 80
const PREFETCH_MARGIN = '800px 0px'

const TYPE_OPTIONS = [
  { value: 'all', label: 'Alle' },
  { value: 'photo', label: 'Fotos' },
  { value: 'video', label: 'Videos' },
]

function groupByDay(items) {
  const groups = []
  let currentKey = null
  let current = null

  for (const item of items) {
    const key = String(item.captured_at || item.created_at || '').slice(0, 10)
    if (key !== currentKey) {
      currentKey = key
      current = { key, label: formatDayHeading(key), items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }

  return groups
}

export function TimelinePage({
  username,
  onLogout,
  onGoStart,
  onGoUpload,
  onGoContent,
  onGoCommunity,
}) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)
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

  const resetMedia = useCallback(() => {
    loadIdRef.current += 1
    isLoadingRef.current = false
    loadedCountRef.current = 0
    setItems([])
    setHasMore(false)
    setHasLoaded(false)
    setError('')
    setIsLoading(false)
    setViewerIndex(null)
  }, [])

  const loadPage = useCallback(async () => {
    if (isLoadingRef.current) {
      return
    }

    const requestId = loadIdRef.current
    isLoadingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const data = await fetchTimelineMedia({
        offset: loadedCountRef.current,
        limit: PAGE_SIZE,
        query: debouncedQuery,
        type: typeFilter,
      })
      if (requestId !== loadIdRef.current) {
        return
      }

      const nextItems = data.items || []
      loadedCountRef.current += nextItems.length
      setItems((current) => (nextItems.length ? [...current, ...nextItems] : current))
      setHasMore(Boolean(data.has_more))
      setHasLoaded(true)
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
  }, [debouncedQuery, typeFilter])

  useEffect(() => {
    resetMedia()
  }, [debouncedQuery, typeFilter, resetMedia])

  const canLoadMore = hasLoaded && hasMore

  useEffect(() => {
    if (hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [hasLoaded, isLoading, loadPage])

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

  const groups = useMemo(() => groupByDay(items), [items])
  const closeViewer = useCallback(() => setViewerIndex(null), [])

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        onGoHome={onGoStart}
        onGoCommunity={onGoCommunity}
        center={
          <AppNav
            current="start"
            onNavigate={(page) => {
              if (page === 'home') onGoUpload()
              if (page === 'content') onGoContent()
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

      <main className="app-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Cloud</p>
            <h1>Mit dir geteilt</h1>
          </div>
        </header>

        <section className="media-toolbar" aria-label="Filter">
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
          </div>
        </section>

        <section className="media-section" aria-label="Mit dir geteilte Dateien">
          {error && <p className="form-error">{error}</p>}

          {hasLoaded && items.length === 0 ? (
            <div className="empty-panel">
              <p>Noch nichts mit dir geteilt.</p>
              <span>
                Wenn jemand Fotos oder Videos mit dir teilt, erscheinen sie
                hier.
              </span>
            </div>
          ) : items.length > 0 ? (
            <div className="timeline-feed">
              {groups.map((group) => (
                <section className="timeline-day" key={group.key || group.label}>
                  <h2 className="timeline-day-title">{group.label}</h2>
                  <div className="media-grid">
                    {group.items.map((item) => {
                      const index = items.indexOf(item)
                      return (
                        <MediaCard
                          item={item}
                          key={mediaKey(item)}
                          onOpen={() => setViewerIndex(index)}
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <p>Lädt…</p>
              <span>Fotos und Videos, die mit dir geteilt wurden, werden geladen.</span>
            </div>
          )}

          {canLoadMore && <div aria-hidden="true" ref={sentinelRef} />}

          {isLoading && (
            <div className="media-more">
              <span className="media-more-status">Lädt weitere Dateien…</span>
            </div>
          )}
        </section>
      </main>

      {viewerIndex !== null && items[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={items}
          onClose={closeViewer}
          onIndexChange={setViewerIndex}
        />
      )}
    </div>
  )
}
