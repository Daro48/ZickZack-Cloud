import { useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { fetchFolderMedia } from '../services/mediaApi.js'

const FOLDER_PAGE_SIZE = 1000

export function ViewContent({ username, onLogout, onGoUpload, onGoCommunity }) {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const loadIdRef = useRef(0)

  function handleFolderChange(folder) {
    loadIdRef.current += 1
    setSelectedFolder(folder)
    setItems([])
    setHasMore(false)
    setHasLoaded(false)
    setError('')
    setIsLoading(false)
  }

  async function loadPage() {
    if (!selectedFolder || isLoading) {
      return
    }

    const requestId = loadIdRef.current
    const folder = selectedFolder

    setIsLoading(true)
    setError('')

    try {
      const data = await fetchFolderMedia(folder, {
        offset: items.length,
        limit: FOLDER_PAGE_SIZE,
      })
      if (requestId !== loadIdRef.current) {
        return
      }
      const nextItems = data.items || []
      setItems((current) => [...current, ...nextItems])
      setHasMore(Boolean(data.has_more))
      setHasLoaded(true)
    } catch (loadError) {
      if (requestId !== loadIdRef.current) {
        return
      }
      setError(loadError.message)
    } finally {
      if (requestId === loadIdRef.current) {
        setIsLoading(false)
      }
    }
  }

  const canLoad = Boolean(selectedFolder) && (!hasLoaded || hasMore)

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
                <article
                  className="media-card"
                  key={`${item.type}-${item.id}`}
                >
                  <div className="media-frame">
                    {item.type === 'photo' ? (
                      <img
                        alt={item.original_name}
                        className="media-thumb"
                        decoding="async"
                        loading="lazy"
                        src={item.thumb_url || item.url}
                      />
                    ) : (
                      <video
                        className="media-thumb"
                        controls
                        playsInline
                        preload="none"
                        src={item.url}
                      />
                    )}
                  </div>
                  <div className="media-meta">
                    <span>{item.type === 'photo' ? 'Foto' : 'Video'}</span>
                    <span>{item.original_name}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <p>Noch nichts geladen.</p>
              <span>
                Mit dem Knopf werden die nächsten {FOLDER_PAGE_SIZE} Dateien
                geladen.
              </span>
            </div>
          )}

          {canLoad && (
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
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
