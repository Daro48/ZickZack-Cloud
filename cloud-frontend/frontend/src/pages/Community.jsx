import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { ShareDialog } from '../components/ShareDialog.jsx'
import { Topbar } from '../components/Topbar.jsx'
import {
  deleteShare,
  fetchCommunity,
  fetchShareMedia,
  mediaKey,
} from '../services/communityApi.js'
import { fetchFolderMedia } from '../services/mediaApi.js'

const PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

function recipientLabel(share) {
  const names = (share.recipients || []).map((entry) => entry.username)
  if (names.length === 0) {
    return 'Keine Empfänger'
  }
  if (names.length <= 2) {
    return names.join(', ')
  }
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

function ShareCard({ share, onOpen, onDelete, isDeleting }) {
  const preview = share.preview || []
  const title =
    share.kind === 'folder' ? share.folder : `${share.item_count} Datei(en)`
  const kicker = share.mine ? 'Von dir geteilt' : `Von ${share.owner?.username}`

  return (
    <article className="share-card">
      <button className="share-card-open" onClick={onOpen} type="button">
        <div className={`share-preview count-${Math.min(preview.length, 4)}`}>
          {preview.length === 0 ? (
            <span className="share-preview-empty">Keine Vorschau</span>
          ) : (
            preview.slice(0, 4).map((item) => (
              <img
                alt=""
                className="share-preview-thumb"
                decoding="async"
                key={mediaKey(item)}
                loading="lazy"
                src={item.thumb_url || item.url}
                onError={(event) => {
                  event.currentTarget.style.opacity = '0'
                }}
              />
            ))
          )}
        </div>
        <div className="share-card-meta">
          <span>{kicker}</span>
          <strong>{title}</strong>
          <em>
            {share.item_count} Datei(en)
            {share.mine ? ` · ${recipientLabel(share)}` : ''}
          </em>
        </div>
      </button>
      {share.mine && (
        <button
          className="ghost-button share-delete"
          disabled={isDeleting}
          onClick={onDelete}
          type="button"
        >
          {isDeleting ? 'Wird beendet…' : 'Freigabe beenden'}
        </button>
      )}
    </article>
  )
}

function MediaPager({
  canLoadMore,
  error,
  emptyTitle,
  emptyHint,
  hasLoaded,
  isLoading,
  items,
  loadPage,
  onOpen,
  selectable = false,
  selectedKeys,
  sentinelRef,
  total,
  onToggleSelect,
}) {
  return (
    <section className="media-section" aria-label="Medien">
      {error && <p className="form-error">{error}</p>}

      {!hasLoaded && items.length === 0 ? (
        <div className="empty-panel">
          <p>Lädt…</p>
          <span>Dateien werden geladen.</span>
        </div>
      ) : hasLoaded && items.length === 0 ? (
        <div className="empty-panel">
          <p>{emptyTitle}</p>
          <span>{emptyHint}</span>
        </div>
      ) : items.length > 0 ? (
        <div className="media-grid">
          {items.map((item, index) => (
            <MediaCard
              item={item}
              key={mediaKey(item)}
              onOpen={() => onOpen(index)}
              onToggleSelect={
                onToggleSelect ? () => onToggleSelect(item) : undefined
              }
              selectable={selectable}
              selected={Boolean(selectedKeys?.has(mediaKey(item)))}
            />
          ))}
        </div>
      ) : null}

      {canLoadMore && <div aria-hidden="true" ref={sentinelRef} />}

      {(isLoading || (hasLoaded && total !== null)) && (
        <div className="media-more">
          {isLoading && <span className="media-more-status">Lädt weitere Dateien…</span>}
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
  )
}

export function Community({
  username,
  onLogout,
  onGoHome,
  onGoUpload,
  onGoContent,
}) {
  const [tab, setTab] = useState('inbox')
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [isFeedLoading, setIsFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [notice, setNotice] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const [selectedFolder, setSelectedFolder] = useState('')
  const [ownItems, setOwnItems] = useState([])
  const [ownTotal, setOwnTotal] = useState(null)
  const [ownHasMore, setOwnHasMore] = useState(false)
  const [ownHasLoaded, setOwnHasLoaded] = useState(false)
  const [ownLoading, setOwnLoading] = useState(false)
  const [ownError, setOwnError] = useState('')
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [shareTarget, setShareTarget] = useState(null)

  const [activeShare, setActiveShare] = useState(null)
  const [shareItems, setShareItems] = useState([])
  const [shareTotal, setShareTotal] = useState(null)
  const [shareHasMore, setShareHasMore] = useState(false)
  const [shareHasLoaded, setShareHasLoaded] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareListError, setShareListError] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)

  const ownLoadIdRef = useRef(0)
  const ownLoadingRef = useRef(false)
  const ownCountRef = useRef(0)
  const ownSentinelRef = useRef(null)

  const shareLoadIdRef = useRef(0)
  const shareLoadingRef = useRef(false)
  const shareCountRef = useRef(0)
  const shareSentinelRef = useRef(null)

  const viewerItems = activeShare ? shareItems : ownItems
  const selectedItems = useMemo(
    () => ownItems.filter((item) => selectedKeys.has(mediaKey(item))),
    [ownItems, selectedKeys],
  )

  const reloadFeed = useCallback(async () => {
    setIsFeedLoading(true)
    setFeedError('')
    try {
      const data = await fetchCommunity()
      setIncoming(data.incoming || [])
      setOutgoing(data.outgoing || [])
    } catch (error) {
      setFeedError(error.message)
    } finally {
      setIsFeedLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadFeed()
  }, [reloadFeed])

  function handleFolderChange(folder) {
    ownLoadIdRef.current += 1
    ownLoadingRef.current = false
    ownCountRef.current = 0
    setSelectedFolder(folder)
    setOwnItems([])
    setOwnTotal(null)
    setOwnHasMore(false)
    setOwnHasLoaded(false)
    setOwnError('')
    setOwnLoading(false)
    setSelectedKeys(new Set())
    setViewerIndex(null)
    setNotice('')
  }

  const loadOwnPage = useCallback(async () => {
    if (!selectedFolder || ownLoadingRef.current) {
      return
    }

    const requestId = ownLoadIdRef.current
    ownLoadingRef.current = true
    setOwnLoading(true)
    setOwnError('')

    try {
      const data = await fetchFolderMedia(selectedFolder, {
        offset: ownCountRef.current,
        limit: PAGE_SIZE,
      })
      if (requestId !== ownLoadIdRef.current) {
        return
      }

      const nextItems = data.items || []
      ownCountRef.current += nextItems.length
      setOwnItems((current) =>
        nextItems.length ? [...current, ...nextItems] : current,
      )
      setOwnHasMore(Boolean(data.has_more))
      setOwnHasLoaded(true)
      if (typeof data.total === 'number') {
        setOwnTotal(data.total)
      }
    } catch (error) {
      if (requestId === ownLoadIdRef.current) {
        setOwnError(error.message)
      }
    } finally {
      if (requestId === ownLoadIdRef.current) {
        setOwnLoading(false)
      }
      ownLoadingRef.current = false
    }
  }, [selectedFolder])

  const loadSharePage = useCallback(async () => {
    if (!activeShare || shareLoadingRef.current) {
      return
    }

    const requestId = shareLoadIdRef.current
    shareLoadingRef.current = true
    setShareLoading(true)
    setShareListError('')

    try {
      const data = await fetchShareMedia(activeShare.id, {
        offset: shareCountRef.current,
        limit: PAGE_SIZE,
      })
      if (requestId !== shareLoadIdRef.current) {
        return
      }

      const nextItems = data.items || []
      shareCountRef.current += nextItems.length
      setShareItems((current) =>
        nextItems.length ? [...current, ...nextItems] : current,
      )
      setShareHasMore(Boolean(data.has_more))
      setShareHasLoaded(true)
      if (typeof data.total === 'number') {
        setShareTotal(data.total)
      }
    } catch (error) {
      if (requestId === shareLoadIdRef.current) {
        setShareListError(error.message)
      }
    } finally {
      if (requestId === shareLoadIdRef.current) {
        setShareLoading(false)
      }
      shareLoadingRef.current = false
    }
  }, [activeShare])

  useEffect(() => {
    if (tab !== 'share' || !selectedFolder || ownHasLoaded || ownLoading) {
      return
    }
    loadOwnPage()
  }, [selectedFolder, tab])

  useEffect(() => {
    if (!activeShare || shareHasLoaded || shareLoading) {
      return
    }
    loadSharePage()
  }, [activeShare?.id])

  useEffect(() => {
    const node = ownSentinelRef.current
    if (!node || tab !== 'share' || !ownHasLoaded || !ownHasMore) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadOwnPage()
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadOwnPage, ownHasLoaded, ownHasMore, tab])

  useEffect(() => {
    const node = shareSentinelRef.current
    if (!node || !activeShare || !shareHasLoaded || !shareHasMore) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadSharePage()
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [activeShare, loadSharePage, shareHasLoaded, shareHasMore])

  function openShare(share) {
    shareLoadIdRef.current += 1
    shareLoadingRef.current = false
    shareCountRef.current = 0
    setActiveShare(share)
    setShareItems([])
    setShareTotal(null)
    setShareHasMore(false)
    setShareHasLoaded(false)
    setShareListError('')
    setShareLoading(false)
    setViewerIndex(null)
  }

  function closeShare() {
    shareLoadIdRef.current += 1
    setActiveShare(null)
    setShareItems([])
    setViewerIndex(null)
  }

  function toggleItem(item) {
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

  function selectAllVisible() {
    setSelectedKeys(new Set(ownItems.map((item) => mediaKey(item))))
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  async function handleDeleteShare(share) {
    const label =
      share.kind === 'folder' ? share.folder : `${share.item_count} Datei(en)`
    if (
      !window.confirm(
        `Freigabe „${label}“ wirklich beenden? Die Dateien bleiben bei dir gespeichert.`,
      )
    ) {
      return
    }

    setDeletingId(share.id)
    setFeedError('')
    try {
      await deleteShare(share.id)
      if (activeShare?.id === share.id) {
        closeShare()
      }
      await reloadFeed()
    } catch (error) {
      setFeedError(error.message)
    } finally {
      setDeletingId(null)
    }
  }

  function handleShared() {
    const count = shareTarget?.kind === 'folder' ? 0 : selectedItems.length
    setShareTarget(null)
    setSelectedKeys(new Set())
    setNotice(
      shareTarget?.kind === 'folder'
        ? `Ordner „${selectedFolder}“ geteilt. Die Dateien bleiben nur einmal gespeichert.`
        : `${count === 1 ? '1 Datei' : `${count} Dateien`} geteilt, ohne sie extra zu speichern.`,
    )
    reloadFeed()
  }

  const closeViewer = useCallback(() => {
    setViewerIndex(null)
  }, [])

  const closeShareDialog = useCallback(() => {
    setShareTarget(null)
  }, [])

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        onGoHome={onGoHome}
        center={
          <nav className="topbar-nav" aria-label="Hauptnavigation">
            <button className="nav-link" onClick={onGoUpload} type="button">
              Upload
            </button>
            <button className="nav-link" onClick={onGoContent} type="button">
              Inhalte
            </button>
            <button className="nav-link is-active" type="button">
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

      <main
        className={`app-page${
          tab === 'share' && !activeShare ? ' has-share-bar' : ''
        }`}
      >
        <header className="page-header">
          <div>
            <p className="eyebrow">Cloud</p>
            <h1>Community</h1>
          </div>
        </header>

        {activeShare ? (
          <>
            <section className="community-toolbar" aria-label="Freigabe">
              <button
                className="ghost-button"
                onClick={closeShare}
                type="button"
              >
                Zurück
              </button>
              <div className="community-toolbar-copy">
                <p>
                  {activeShare.kind === 'folder'
                    ? activeShare.folder
                    : 'Auswahl'}
                </p>
                <span>
                  {activeShare.mine
                    ? `Geteilt mit ${recipientLabel(activeShare)}`
                    : `Von ${activeShare.owner?.username}`}
                  {shareTotal !== null ? ` · ${shareTotal} Datei(en)` : ''}
                </span>
              </div>
            </section>

            <MediaPager
              canLoadMore={shareHasLoaded && shareHasMore}
              emptyHint="In dieser Freigabe liegt gerade nichts."
              emptyTitle="Keine Dateien"
              error={shareListError}
              hasLoaded={shareHasLoaded}
              isLoading={shareLoading}
              items={shareItems}
              loadPage={loadSharePage}
              onOpen={setViewerIndex}
              sentinelRef={shareSentinelRef}
              total={shareTotal}
            />
          </>
        ) : (
          <>
            <div className="community-tabs" role="tablist" aria-label="Community">
              <button
                aria-selected={tab === 'inbox'}
                className={`community-tab${tab === 'inbox' ? ' is-active' : ''}`}
                onClick={() => setTab('inbox')}
                role="tab"
                type="button"
              >
                Empfangen
              </button>
              <button
                aria-selected={tab === 'share'}
                className={`community-tab${tab === 'share' ? ' is-active' : ''}`}
                onClick={() => setTab('share')}
                role="tab"
                type="button"
              >
                Teilen
              </button>
            </div>

            {tab === 'share' && (
              <>
                <FolderPicker
                  allowCreate={false}
                  folder={selectedFolder}
                  onFolderChange={handleFolderChange}
                  username={username}
                />

                <section className="community-actions" aria-label="Teilen">
                  <p className="folder-hint">
                    Dateien werden nur freigegeben, nicht kopiert. Markiere
                    einzelne Fotos und Videos oder teile den ganzen Ordner.
                    Danach wählst du die User.
                  </p>
                  {notice && <p className="form-success">{notice}</p>}
                </section>

                <div className="community-action-bar">
                  <div className="community-action-row">
                    <div className="community-action-group">
                      <button
                        className="ghost-button"
                        disabled={!ownItems.length}
                        onClick={selectAllVisible}
                        type="button"
                      >
                        Alle markieren
                      </button>
                      <button
                        className="ghost-button"
                        disabled={selectedItems.length === 0}
                        onClick={clearSelection}
                        type="button"
                      >
                        Aufheben
                      </button>
                    </div>
                    <div className="community-action-group is-share">
                      <button
                        className="secondary-button"
                        disabled={!selectedFolder}
                        onClick={() =>
                          setShareTarget({
                            kind: 'folder',
                            folder: selectedFolder,
                          })
                        }
                        type="button"
                      >
                        Ordner teilen
                      </button>
                      <button
                        className="primary-button"
                        disabled={selectedItems.length === 0}
                        onClick={() =>
                          setShareTarget({
                            kind: 'items',
                            items: selectedItems,
                          })
                        }
                        type="button"
                      >
                        {selectedItems.length > 0
                          ? `${selectedItems.length} teilen`
                          : 'Auswahl teilen'}
                      </button>
                    </div>
                  </div>
                </div>

                {selectedFolder ? (
                  <MediaPager
                    canLoadMore={ownHasLoaded && ownHasMore}
                    emptyHint="Lade Dateien über Upload hoch, dann kannst du sie hier teilen."
                    emptyTitle="Dieser Ordner ist noch leer."
                    error={ownError}
                    hasLoaded={ownHasLoaded}
                    isLoading={ownLoading}
                    items={ownItems}
                    loadPage={loadOwnPage}
                    onOpen={setViewerIndex}
                    onToggleSelect={toggleItem}
                    selectable
                    selectedKeys={selectedKeys}
                    sentinelRef={ownSentinelRef}
                    total={ownTotal}
                  />
                ) : (
                  <section className="media-section">
                    <div className="empty-panel">
                      <p>Ordner wählen.</p>
                      <span>
                        Danach markierst du einzelne Fotos und Videos oder teilst
                        den ganzen Ordner.
                      </span>
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === 'inbox' && (
              <section className="media-section" aria-label="Empfangen">
                {feedError && <p className="form-error">{feedError}</p>}
                {isFeedLoading ? (
                  <div className="empty-panel">
                    <p>Lädt…</p>
                    <span>Freigaben werden geladen.</span>
                  </div>
                ) : incoming.length === 0 ? (
                  <div className="empty-panel">
                    <p>Noch nichts geteilt bekommen.</p>
                    <span>
                      Sobald dir jemand Ordner oder Dateien freigibt, erscheinen
                      sie hier.
                    </span>
                  </div>
                ) : (
                  <div className="share-grid">
                    {incoming.map((share) => (
                      <ShareCard
                        isDeleting={deletingId === share.id}
                        key={share.id}
                        onDelete={() => handleDeleteShare(share)}
                        onOpen={() => openShare(share)}
                        share={share}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === 'share' && (
              <section className="media-section" aria-label="Deine Freigaben">
                <div className="media-heading-row">
                  <h2 className="media-heading">Deine Freigaben</h2>
                  <p className="media-subheading">
                    Verweise auf deine Originale, keine zweiten Kopien.
                  </p>
                </div>
                {feedError && <p className="form-error">{feedError}</p>}
                {!isFeedLoading && outgoing.length === 0 ? (
                  <div className="empty-panel">
                    <p>Noch keine Freigaben.</p>
                    <span>
                      Markiere Dateien oder teile einen Ordner, danach die User.
                    </span>
                  </div>
                ) : (
                  <div className="share-grid">
                    {outgoing.map((share) => (
                      <ShareCard
                        isDeleting={deletingId === share.id}
                        key={share.id}
                        onDelete={() => handleDeleteShare(share)}
                        onOpen={() => openShare(share)}
                        share={share}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {viewerIndex !== null && viewerItems[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={viewerItems}
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
