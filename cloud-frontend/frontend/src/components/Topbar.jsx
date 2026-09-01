export function Topbar({ action, username, center, onGoHome }) {
  const logo = (
    <>
      Cloud
      <span className="topbar-version">Version 1.1.1</span>
    </>
  )

  return (
    <header className="topbar">
      {onGoHome ? (
        <button
          aria-label="Zur Startseite"
          className="topbar-logo"
          onClick={onGoHome}
          type="button"
        >
          {logo}
        </button>
      ) : (
        <span className="topbar-logo">{logo}</span>
      )}

      <div className="topbar-center">{center}</div>

      <div className="topbar-meta">
        {username && <span className="topbar-user">{username.toUpperCase()}</span>}
        {action}
      </div>
    </header>
  )
}
