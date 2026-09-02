import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { SelectionPopup } from '../components/SelectionPopup.jsx'
import { ShareDialog } from '../components/ShareDialog.jsx'
import { Topbar } from '../components/Topbar.jsx'
import {
  createShareLink,
  deleteShare,
  fetchCommunity,
  fetchShareMedia,
  leaveShare,
  mediaKey,
} from '../services/communityApi.js'
import { fetchFolderMedia } from '../services/mediaApi.js'
import { absoluteUrl, copyText } from '../utils/format.js'

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

function ShareCard({ share, onOpen, onDelete, onLeave, onCopyLink, isDeleting, isLeaving }) {
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
          {share.note && <em className="share-card-note">{share.note}</em>}
          <em>
            {share.item_count} Datei(en)
            {share.mine ? ` · ${recipientLabel(share)}` : ''}
          </em>
        </div>
      </button>
      {share.mine && (
        <div className="share-card-actions">
          <button
            className="ghost-button"
            onClick={onCopyLink}
            type="button"
          >
            {share.public_link ? 'Link kopieren' : 'Öffentlicher Link'}
          </button>
          <button
            className="ghost-button share-delete"
            disabled={isDeleting}
            onClick={onDelete}
            type="button"
          >
            {isDeleting ? 'Wird beendet…' : 'Freigabe beenden'}
          </button>
        </div>
      )}
      {!share.mine && (
        <button
          className="ghost-button share-delete"
          disabled={isLeaving}
          onClick={onLeave}
          type="button"
        >
          {isLeaving ? 'Wird verlassen…' : 'Verlassen'}
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
  const [leavingId, setLeavingId] = useState(null)
  const [dialog, setDialog] = useState(null)

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
    setDialog({ type: 'end-share', share })
  }

  async function executeDeleteShare(share) {
    setDeletingId(share.id)
    setFeedError('')
    try {
      await deleteShare(share.id)
      if (activeShare?.id === share.id) {
        closeShare()
      }
      setDialog(null)
      await reloadFeed()
    } catch (error) {
      setFeedError(error.message)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleLeaveShare(share) {
    setDialog({ type: 'leave-share', share })
  }

  async function executeLeaveShare(share) {
    setLeavingId(share.id)
    setFeedError('')
    try {
      await leaveShare(share.id)
      if (activeShare?.id === share.id) {
        closeShare()
      }
      setDialog(null)
      await reloadFeed()
    } catch (error) {
      setFeedError(error.message)
    } finally {
      setLeavingId(null)
    }
  }

  async function handlePublicLink(share) {
    if (share.public_link?.url) {
      const full = absoluteUrl(share.public_link.url)
      const copied = await copyText(full)
      setNotice(copied ? 'Öffentlicher Link kopiert.' : full)
      return
    }
    setDialog({ type: 'public-link', share })
  }

  async function executePublicLink(share) {
    setFeedError('')
    try {
      const data = await createShareLink(share.id, 7)
      const full = absoluteUrl(data.public_link?.url)
      const copied = await copyText(full)
      setNotice(
        copied
          ? 'Öffentlicher Link erstellt und kopiert. Er gilt 7 Tage.'
          : full,
      )
      setDialog(null)
      await reloadFeed()
    } catch (error) {
      setFeedError(error.message)
    }
  }

  function handleShared(data) {
    const shares = data?.shares || (data?.share ? [data.share] : [])
    const count = shareTarget?.kind === 'folder' || shareTarget?.kind === 'folders'
      ? shares.length
      : selectedItems.length
    setShareTarget(null)
    setSelectedKeys(new Set())
    const link = shares.find((entry) => entry.public_link)?.public_link
    let message =
      shareTarget?.kind === 'folder' || shareTarget?.kind === 'folders'
        ? count > 1
          ? `${count} Ordner geteilt, ohne sie extra zu speichern.`
          : `Ordner geteilt, ohne ihn extra zu speichern.`
        : `${count === 1 ? '1 Datei' : `${count} Dateien`} geteilt, ohne sie extra zu speichern.`
    if (link?.url) {
      message += ` Link: ${absoluteUrl(link.url)}`
      copyText(absoluteUrl(link.url))
    }
    setNotice(message)
    reloadFeed()
  }

  const closeViewer = useCallback(() => {
    setViewerIndex(null)
  }, [])

  const closeShareDialog = useCallback(() => {
    setShareTarget(null)
  }, [])

  const closeDialog = useCallback(() => {
    if (!deletingId && !leavingId) {
      setDialog(null)
    }
  }, [deletingId, leavingId])

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        onGoHome={onGoHome}
        onGoCommunity={() => {}}
        center={
          <AppNav
            current="community"
            onNavigate={(page) => {
              if (page === 'home') onGoUpload()
              if (page === 'content') onGoContent()
            }}
          />
        }
        action={
          <button className="secondary-button" type="button" onClick={onLogout}>
            Abmelden
          </button>
        }
      />

      <main
        className={`app-page${
          selectedItems.length > 0 ? ' has-selection-popup' : ''
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
                {activeShare.note && <span>{activeShare.note}</span>}
              </div>
              {activeShare.mine ? (
                <button
                  className="ghost-button share-delete"
                  disabled={deletingId === activeShare.id}
                  onClick={() => handleDeleteShare(activeShare)}
                  type="button"
                >
                  {deletingId === activeShare.id
                    ? 'Wird beendet…'
                    : 'Freigabe beenden'}
                </button>
              ) : (
                <button
                  className="ghost-button share-delete"
                  disabled={leavingId === activeShare.id}
                  onClick={() => handleLeaveShare(activeShare)}
                  type="button"
                >
                  {leavingId === activeShare.id ? 'Wird verlassen…' : 'Verlassen'}
                </button>
              )}
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
                <section className="media-section" aria-label="Deine Freigaben">
                  <div className="media-heading-row">
                    <h2 className="media-heading">Deine Freigaben</h2>
                    <p className="media-subheading">
                      Verweise auf deine Originale, keine zweiten Kopien.
                    </p>
                  </div>
                  {feedError && <p className="form-error">{feedError}</p>}
                  {isFeedLoading ? (
                    <div className="empty-panel">
                      <p>Lädt…</p>
                      <span>Deine Freigaben werden geladen.</span>
                    </div>
                  ) : outgoing.length === 0 ? (
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
                          onCopyLink={() => handlePublicLink(share)}
                          onDelete={() => handleDeleteShare(share)}
                          onOpen={() => openShare(share)}
                          share={share}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <FolderPicker
                  allowCreate={false}
                  folder={selectedFolder}
                  onFolderChange={handleFolderChange}
                  username={username}
                />

                <section className="community-actions" aria-label="Teilen">
                  <p className="folder-hint">
                    Dateien werden nur freigegeben, nicht kopiert. Markiere
                    Fotos oder Videos — die Aktionen erscheinen unten.
                  </p>
                  <div className="media-toolbar-row">
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
                      Ganzen Ordner teilen
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        setShareTarget({
                          kind: 'folders',
                          folder: selectedFolder,
                        })
                      }
                      type="button"
                    >
                      Mehrere Ordner teilen
                    </button>
                  </div>
                  {notice && <p className="form-success">{notice}</p>}
                </section>

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
                        isLeaving={leavingId === share.id}
                        key={share.id}
                        onLeave={() => handleLeaveShare(share)}
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

      <SelectionPopup
        count={tab === 'share' && !activeShare ? selectedItems.length : 0}
        onClear={clearSelection}
        onSelectAll={ownItems.length > 0 ? selectAllVisible : undefined}
        onShare={() =>
          setShareTarget({
            kind: 'items',
            items: selectedItems,
          })
        }
      />

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

      {dialog?.type === 'end-share' && (
        <ConfirmDialog
          busy={deletingId === dialog.share.id}
          confirmLabel="Freigabe beenden"
          danger
          description={`Die Freigabe „${
            dialog.share.kind === 'folder'
              ? dialog.share.folder
              : `${dialog.share.item_count} Datei(en)`
          }“ wird beendet. Die Dateien bleiben bei dir gespeichert.`}
          error={feedError}
          onCancel={closeDialog}
          onConfirm={() => executeDeleteShare(dialog.share)}
          title="Freigabe beenden"
        />
      )}

      {dialog?.type === 'leave-share' && (
        <ConfirmDialog
          busy={leavingId === dialog.share.id}
          confirmLabel="Freigabe verlassen"
          danger
          description={`Du siehst „${
            dialog.share.kind === 'folder'
              ? dialog.share.folder
              : `${dialog.share.item_count} Datei(en)`
          }“ danach nicht mehr. Die Dateien bleiben beim Absender.`}
          error={feedError}
          onCancel={closeDialog}
          onConfirm={() => executeLeaveShare(dialog.share)}
          title="Freigabe verlassen"
        />
      )}

      {dialog?.type === 'public-link' && (
        <ConfirmDialog
          confirmLabel="Link für 7 Tage erstellen"
          description="Jeder mit dem Link kann die Freigabe ohne Konto sehen, bis sie nach 7 Tagen abläuft."
          error={feedError}
          onCancel={closeDialog}
          onConfirm={() => executePublicLink(dialog.share)}
          title="Öffentlichen Link erstellen"
        />
      )}
    </div>
  )
}
