export function Topbar({ action, username, center }) {
  return (
    <header className="topbar">
      <a className="topbar-logo" href="/" aria-label="Cloud Startseite">
        cloud
      </a>

      <div className="topbar-center">{center}</div>

      <div className="topbar-meta">
        {username && <span className="topbar-user">{username}</span>}
        {action}
      </div>
    </header>
  )
}
