import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { FeedPost } from '../components/FeedPost.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { fetchFeed, mediaKey } from '../services/communityApi.js'
import { fetchTimelineMedia } from '../services/mediaApi.js'
import { formatDayHeading } from '../utils/format.js'

const PAGE_SIZE = 80
const FEED_PAGE_SIZE = 12
const PREFETCH_MARGIN = '800px 0px'

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

function usePagedMedia({ load, resetDeps, enabled = true }) {
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const loadIdRef = useRef(0)
  const isLoadingRef = useRef(false)
  const loadedCountRef = useRef(0)

  const resetMedia = useCallback(() => {
    loadIdRef.current += 1
    isLoadingRef.current = false
    loadedCountRef.current = 0
    setItems([])
    setHasMore(false)
    setHasLoaded(false)
    setError('')
    setIsLoading(false)
  }, [])

  const loadPage = useCallback(async () => {
    if (!enabled || isLoadingRef.current) {
      return
    }

    const requestId = loadIdRef.current
    isLoadingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const data = await load(loadedCountRef.current)
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
        setHasLoaded(true)
      }
    } finally {
      if (requestId === loadIdRef.current) {
        setIsLoading(false)
      }
      isLoadingRef.current = false
    }
  }, [enabled, load])

  const resetKey = resetDeps.join('\0')

  useEffect(() => {
    resetMedia()
  }, [resetMedia, resetKey])

  useEffect(() => {
    if (!enabled || hasLoaded || isLoading) {
      return
    }
    loadPage()
  }, [enabled, hasLoaded, isLoading, loadPage])

  return {
    items,
    setItems,
    hasMore,
    hasLoaded,
    isLoading,
    error,
    loadPage,
  }
}

function useScrollSentinel(enabled, loadPage) {
  const sentinelRef = useRef(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !enabled) {
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
  }, [enabled, loadPage])

  return sentinelRef
}

export function TimelinePage({
  username,
  onLogout,
  onGoStart,
  onGoUpload,
  onGoContent,
  onGoCommunity,
}) {
  const [tab, setTab] = useState('shared')
  const [viewer, setViewer] = useState(null)

  const loadShared = useCallback(
    (offset) =>
      fetchTimelineMedia({
        offset,
        limit: PAGE_SIZE,
      }),
    [],
  )

  const loadFeed = useCallback(
    (offset) => fetchFeed({ offset, limit: FEED_PAGE_SIZE }),
    [],
  )

  const shared = usePagedMedia({
    load: loadShared,
    resetDeps: [],
  })
  const feed = usePagedMedia({
    enabled: tab === 'feed',
    load: loadFeed,
    resetDeps: [],
  })

  const sharedSentinelRef = useScrollSentinel(
    tab === 'shared' && shared.hasLoaded && shared.hasMore,
    shared.loadPage,
  )
  const feedSentinelRef = useScrollSentinel(
    tab === 'feed' && feed.hasLoaded && feed.hasMore,
    feed.loadPage,
  )

  const groups = useMemo(() => groupByDay(shared.items), [shared.items])
  const viewerItems =
    viewer?.source === 'feed'
      ? feed.items
      : viewer?.source === 'shared'
        ? shared.items
        : []
  const viewerIndex = viewer?.index ?? null

  function updateFeedItem(nextItem) {
    feed.setItems((current) =>
      current.map((item) =>
        mediaKey(item) === mediaKey(nextItem) ? nextItem : item,
      ),
    )
  }

  function selectTab(next) {
    if (next === tab) {
      return
    }
    setViewer(null)
    setTab(next)
  }

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
            <h1>{tab === 'feed' ? 'Feed' : 'Mit dir geteilt'}</h1>
          </div>
        </header>

        <div className="community-tabs" role="tablist" aria-label="Start">
          <button
            aria-selected={tab === 'shared'}
            className={`community-tab${tab === 'shared' ? ' is-active' : ''}`}
            onClick={() => selectTab('shared')}
            role="tab"
            type="button"
          >
            Mit dir geteilt
          </button>
          <button
            aria-selected={tab === 'feed'}
            className={`community-tab${tab === 'feed' ? ' is-active' : ''}`}
            onClick={() => selectTab('feed')}
            role="tab"
            type="button"
          >
            Feed
          </button>
        </div>

        {tab === 'shared' && (
            <section className="media-section" aria-label="Mit dir geteilte Dateien">
              {shared.error && <p className="form-error">{shared.error}</p>}

              {shared.hasLoaded && shared.items.length === 0 && !shared.error ? (
                <div className="empty-panel">
                  <p>Noch nichts mit dir geteilt.</p>
                  <span>
                    Wenn jemand Fotos oder Videos nur mit dir teilt, erscheinen
                    sie hier.
                  </span>
                </div>
              ) : shared.items.length > 0 ? (
                <div className="timeline-feed">
                  {groups.map((group) => (
                    <section className="timeline-day" key={group.key || group.label}>
                      <h2 className="timeline-day-title">{group.label}</h2>
                      <div className="media-grid">
                        {group.items.map((item) => {
                          const index = shared.items.indexOf(item)
                          return (
                            <MediaCard
                              item={item}
                              key={mediaKey(item)}
                              onOpen={() => setViewer({ source: 'shared', index })}
                            />
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : shared.error ? null : (
                <div className="empty-panel">
                  <p>Lädt…</p>
                  <span>
                    Fotos und Videos, die mit dir geteilt wurden, werden geladen.
                  </span>
                </div>
              )}

              {shared.hasLoaded && shared.hasMore && (
                <div aria-hidden="true" ref={sharedSentinelRef} />
              )}

              {shared.isLoading && (
                <div className="media-more">
                  <span className="media-more-status">Lädt weitere Dateien…</span>
                </div>
              )}
            </section>
        )}

        {tab === 'feed' && (
          <section className="media-section is-feed" aria-label="Feed">
            {feed.error && <p className="form-error">{feed.error}</p>}

            {feed.hasLoaded && feed.items.length === 0 && !feed.error ? (
              <div className="empty-panel">
                <p>Noch nichts im Feed.</p>
                <span>
                  Wenn jemand Dateien mit allen teilt, erscheinen sie hier —
                  jeden Tag in neuer Reihenfolge.
                </span>
              </div>
            ) : feed.items.length > 0 ? (
              <div className="community-feed">
                {feed.items.map((item, index) => (
                  <FeedPost
                    item={item}
                    key={mediaKey(item)}
                    onItemChange={updateFeedItem}
                    onOpen={() => setViewer({ source: 'feed', index })}
                  />
                ))}
              </div>
            ) : feed.error ? null : (
              <div className="empty-panel">
                <p>Lädt…</p>
                <span>Der Feed wird geladen.</span>
              </div>
            )}

            {feed.hasLoaded && feed.hasMore && (
              <div aria-hidden="true" ref={feedSentinelRef} />
            )}

            {feed.isLoading && (
              <div className="media-more">
                <span className="media-more-status">Lädt weitere Beiträge…</span>
              </div>
            )}
          </section>
        )}
      </main>

      {viewerIndex !== null && viewerItems[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={viewerItems}
          onClose={() => setViewer(null)}
          onIndexChange={(index) =>
            setViewer((current) => (current ? { ...current, index } : current))
          }
        />
      )}
    </div>
  )
}
