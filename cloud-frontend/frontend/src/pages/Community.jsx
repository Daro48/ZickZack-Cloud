import { Topbar } from '../components/Topbar.jsx'

export function Community({ username, onLogout, onGoUpload }) {
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
            <h1>Community</h1>
          </div>
        </header>

        <section className="media-section" aria-label="Community">
          <div className="empty-panel">
            <p>Dieser Bereich folgt in Kürze.</p>
            <span>Community-Funktionen werden hier später verfügbar sein.</span>
          </div>
        </section>
      </main>
    </div>
  )
}
