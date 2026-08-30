export function Topbar({ action, username, center }) {
  return (
    <header className="topbar">
      <a className="topbar-logo" href="/" aria-label="Startseite">
        Cloud
      </a>

      <div className="topbar-center">{center}</div>

      <div className="topbar-meta">
        {username && <span className="topbar-user">{username.toUpperCase()}</span>}
        {action}
      </div>
    </header>
  )
}
