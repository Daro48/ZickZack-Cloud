import { Topbar } from './Topbar.jsx'

export function AuthLayout({ children }) {
  return (
    <div className="app-shell">
      <Topbar />

      <main className="auth-page">
        <section className="auth-shell" aria-label="Cloud">
          <div className="auth-brand">
            <span>Cloud</span>
          </div>
          <div className="auth-panel">{children}</div>
        </section>
      </main>
    </div>
  )
}
