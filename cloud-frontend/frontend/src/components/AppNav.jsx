const LINKS = [
  { page: 'home', href: '/upload', label: 'Upload' },
  { page: 'content', href: '/inhalte', label: 'Inhalte' },
  { page: 'community', href: '/community', label: 'Community' },
]

export function AppNav({ current, onNavigate }) {
  return (
    <nav className="topbar-nav" aria-label="Hauptnavigation">
      {LINKS.map((link) => (
        <a
          className={`nav-link${current === link.page ? ' is-active' : ''}`}
          href={link.href}
          key={link.page}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.altKey ||
              event.ctrlKey ||
              event.shiftKey
            ) {
              return
            }
            event.preventDefault()
            onNavigate?.(link.page)
          }}
        >
          {link.label}
        </a>
      ))}
    </nav>
  )
}
