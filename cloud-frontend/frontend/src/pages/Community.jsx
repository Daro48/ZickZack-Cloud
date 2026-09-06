import { useCallback, useEffect, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { ChangePasswordDialog } from '../components/ChangePasswordDialog.jsx'
import { MessagesDialog } from '../components/MessagesDialog.jsx'
import { UsersDialog } from '../components/UsersDialog.jsx'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { MediaCard } from '../components/MediaCard.jsx'
import { MediaViewer } from '../components/MediaViewer.jsx'
import { Topbar } from '../components/Topbar.jsx'
import {
  deleteShare,
  fetchCommunity,
  fetchShareMedia,
  mediaKey,
} from '../services/communityApi.js'

const PAGE_SIZE = 200
const PREFETCH_MARGIN = '800px 0px'

function recipientLabel(share) {
  if (share.audience === 'everyone') {
    return 'Alle im Feed'
  }
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
  const kicker =
    share.audience === 'everyone' ? 'Im Feed' : 'Von dir geteilt'

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
            {share.item_count} Datei(en) · {recipientLabel(share)}
          </em>
        </div>
      </button>
      <div className="share-card-actions">
        <button
          className="ghost-button share-delete"
          disabled={isDeleting}
          onClick={onDelete}
          type="button"
        >
          {isDeleting ? 'Wird beendet…' : 'Freigabe beenden'}
        </button>
      </div>
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
  sentinelRef,
  total,
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
  isAdmin = false,
  onLogout,
  onGoStart,
  onGoUpload,
  onGoContent,
  isActive = true,
}) {
  const [outgoing, setOutgoing] = useState([])
  const [isFeedLoading, setIsFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [usersOpen, setUsersOpen] = useState(false)

  const [activeShare, setActiveShare] = useState(null)
  const [shareItems, setShareItems] = useState([])
  const [shareTotal, setShareTotal] = useState(null)
  const [shareHasMore, setShareHasMore] = useState(false)
  const [shareHasLoaded, setShareHasLoaded] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareListError, setShareListError] = useState('')
  const [viewerIndex, setViewerIndex] = useState(null)

  const shareLoadIdRef = useRef(0)
  const shareLoadingRef = useRef(false)
  const shareCountRef = useRef(0)
  const shareSentinelRef = useRef(null)
  const wasActiveRef = useRef(isActive)

  const reloadFeed = useCallback(async () => {
    setIsFeedLoading(true)
    setFeedError('')
    try {
      const data = await fetchCommunity()
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

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      reloadFeed()
    }
    wasActiveRef.current = isActive
  }, [isActive, reloadFeed])

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
        shareLoadingRef.current = false
      }
    }
  }, [activeShare])

  useEffect(() => {
    if (!activeShare || shareHasLoaded || shareLoading) {
      return
    }
    loadSharePage()
  }, [activeShare?.id])

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
  }, [activeShare, loadSharePage, shareHasLoaded, shareHasMore, shareItems.length])

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

  const closeViewer = useCallback(() => {
    setViewerIndex(null)
  }, [])

  const closeDialog = useCallback(() => {
    if (!deletingId) {
      setDialog(null)
    }
  }, [deletingId])

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        onGoHome={onGoStart}
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

      <main className="app-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Cloud</p>
            <h1>Community</h1>
          </div>
          <div className="page-header-actions">
            <button
              className="secondary-button"
              onClick={() => setMessagesOpen(true)}
              type="button"
            >
              Nachrichten
            </button>
            <button
              className="ghost-button"
              onClick={() => setAccountOpen(true)}
              type="button"
            >
              Konto
            </button>
            {isAdmin && (
              <button
                className="ghost-button"
                onClick={() => setUsersOpen(true)}
                type="button"
              >
                User
              </button>
            )}
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
                  {`Geteilt mit ${recipientLabel(activeShare)}`}
                  {shareTotal !== null ? ` · ${shareTotal} Datei(en)` : ''}
                </span>
                {activeShare.note && <span>{activeShare.note}</span>}
              </div>
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
          <section className="media-section" aria-label="Deine Freigaben">
            <div className="media-heading-row">
              <h2 className="media-heading">Deine Freigaben</h2>
              <p className="media-subheading">Keine Kopien.</p>
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
                <span>Teile unter Inhalte.</span>
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
      </main>

      {viewerIndex !== null && shareItems[viewerIndex] && (
        <MediaViewer
          index={viewerIndex}
          items={shareItems}
          onClose={closeViewer}
          onIndexChange={setViewerIndex}
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

      {messagesOpen && (
        <MessagesDialog
          isAdmin={isAdmin}
          onClose={() => setMessagesOpen(false)}
        />
      )}

      {accountOpen && (
        <ChangePasswordDialog onClose={() => setAccountOpen(false)} />
      )}

      {usersOpen && <UsersDialog onClose={() => setUsersOpen(false)} />}
    </div>
  )
}
