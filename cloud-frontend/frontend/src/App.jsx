import { useEffect, useState } from 'react'
import './App.css'
import { AuthLayout } from './components/AuthLayout.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { TimelinePage } from './pages/TimelinePage.jsx'
import { Community } from './pages/Community.jsx'
import { ViewContent } from './pages/ViewContent.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { RecoveryCodePage } from './pages/RecoveryCodePage.jsx'
import { RegisterPage } from './pages/RegisterPage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  resetPassword,
} from './services/authApi.js'
import {
  APP_PAGES,
  AUTH_PAGES,
  PAGE_TITLES,
  parseLocation,
  pathForPage,
} from './utils/paths.js'
import { applyTheme, getStoredTheme } from './utils/theme.js'

applyTheme(getStoredTheme())

function App() {
  const initialLocation = parseLocation(window.location.pathname)
  const [page, setPage] = useState(
    initialLocation.page === 'unknown' ? 'login' : initialLocation.page,
  )
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [seenPages, setSeenPages] = useState({
    start: true,
    home: initialLocation.page === 'home',
    content: initialLocation.page === 'content',
    community: initialLocation.page === 'community',
  })

  function syncHistory(nextPage, { replace = false } = {}) {
    const path = pathForPage(nextPage)
    const current = `${window.location.pathname}`
    if (current === path) {
      return
    }
    if (replace) {
      window.history.replaceState({ page: nextPage }, '', path)
    } else {
      window.history.pushState({ page: nextPage }, '', path)
    }
  }

  function openPage(nextPage, options = {}) {
    setSeenPages((current) =>
      nextPage in current ? { ...current, [nextPage]: true } : current,
    )
    setPage(nextPage)
    syncHistory(nextPage, { replace: options.replace })
  }

  useEffect(() => {
    function handlePopState() {
      const next = parseLocation(window.location.pathname)
      if (next.page === 'unknown') {
        return
      }
      setSeenPages((current) =>
        next.page in current ? { ...current, [next.page]: true } : current,
      )
      setPage(next.page)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        const data = await getCurrentUser()
        if (!isMounted) {
          return
        }
        setUser(data.user)
        const current = parseLocation(window.location.pathname)
        if (current.page === 'recovery-code' && recoveryCode) {
          setPage('recovery-code')
        } else if (APP_PAGES.has(current.page)) {
          setSeenPages((seen) =>
            current.page in seen ? { ...seen, [current.page]: true } : seen,
          )
          setPage(current.page)
          syncHistory(current.page, { replace: true })
        } else {
          openPage('start', { replace: true })
        }
      } catch {
        if (!isMounted) {
          return
        }
        setUser(null)
        const current = parseLocation(window.location.pathname)
        if (AUTH_PAGES.has(current.page) && current.page !== 'recovery-code') {
          setPage(current.page)
          syncHistory(current.page, { replace: true })
        } else {
          openPage('login', { replace: true })
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false)
        }
      }
    }

    checkSession()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const label = PAGE_TITLES[page]
    document.title = label ? `${label} · Cloud` : 'Cloud'
  }, [page])

  async function handleLogin({ username, password }) {
    setIsSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    try {
      const data = await loginUser({ username, password })
      setUser(data.user || { username })
      openPage('start')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRegister({ username, password }) {
    setIsSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    try {
      const registerData = await registerUser({ username, password })
      const data = await loginUser({ username, password })
      setUser(data.user || { username })
      setRecoveryCode(registerData.recovery_code || '')
      openPage(registerData.recovery_code ? 'recovery-code' : 'start')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResetPassword({ username, recoveryCode: code, password }) {
    setIsSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    try {
      await resetPassword({ username, recoveryCode: code, password })
      setAuthNotice('Passwort gespeichert. Du kannst dich jetzt anmelden.')
      openPage('login')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await logoutUser()
    } finally {
      setUser(null)
      setAuthError('')
      setAuthNotice('')
      setSeenPages({ start: true, home: false, content: false, community: false })
      openPage('login')
    }
  }

  function showLogin() {
    setAuthError('')
    setAuthNotice('')
    openPage('login')
  }

  function showRegister() {
    setAuthError('')
    setAuthNotice('')
    openPage('register')
  }

  function showResetPassword() {
    setAuthError('')
    setAuthNotice('')
    openPage('reset-password')
  }

  if (isCheckingSession) {
    return (
      <AuthLayout>
        <section className="auth-card" aria-live="polite">
          <p className="eyebrow">Cloud</p>
          <h1>Lädt…</h1>
          <p className="auth-copy">Deine Sitzung wird geprüft.</p>
        </section>
      </AuthLayout>
    )
  }

  if (page === 'recovery-code' && user && recoveryCode) {
    return (
      <AuthLayout>
        <RecoveryCodePage
          recoveryCode={recoveryCode}
          onContinue={() => {
            setRecoveryCode('')
            openPage('start')
          }}
        />
      </AuthLayout>
    )
  }

  if (user && (page === 'start' || page === 'home' || page === 'content' || page === 'community')) {
    return (
      <>
        {seenPages.start && (
          <div hidden={page !== 'start'}>
            <TimelinePage
              username={user.username}
              isActive={page === 'start'}
              onLogout={handleLogout}
              onGoStart={() => openPage('start')}
              onGoUpload={() => openPage('home')}
              onGoContent={() => openPage('content')}
              onGoCommunity={() => openPage('community')}
            />
          </div>
        )}
        {seenPages.home && (
          <div hidden={page !== 'home'}>
            <HomePage
              username={user.username}
              onLogout={handleLogout}
              onGoStart={() => openPage('start')}
              onGoUpload={() => openPage('home')}
              onGoContent={() => openPage('content')}
              onGoCommunity={() => openPage('community')}
            />
          </div>
        )}
        {seenPages.content && (
          <div hidden={page !== 'content'}>
            <ViewContent
              username={user.username}
              isActive={page === 'content'}
              onLogout={handleLogout}
              onGoStart={() => openPage('start')}
              onGoUpload={() => openPage('home')}
              onGoCommunity={() => openPage('community')}
            />
          </div>
        )}
        {seenPages.community && (
          <div hidden={page !== 'community'}>
            <Community
              username={user.username}
              isActive={page === 'community'}
              onLogout={handleLogout}
              onGoStart={() => openPage('start')}
              onGoUpload={() => openPage('home')}
              onGoContent={() => openPage('content')}
            />
          </div>
        )}
      </>
    )
  }

  let authPage = (
    <LoginPage
      error={authError}
      notice={authNotice}
      isSubmitting={isSubmitting}
      onLogin={handleLogin}
      onShowRegister={showRegister}
      onShowResetPassword={showResetPassword}
    />
  )

  if (page === 'register') {
    authPage = (
      <RegisterPage
        error={authError}
        isSubmitting={isSubmitting}
        onRegister={handleRegister}
        onShowLogin={showLogin}
      />
    )
  } else if (page === 'reset-password') {
    authPage = (
      <ResetPasswordPage
        error={authError}
        notice={authNotice}
        isSubmitting={isSubmitting}
        onResetPassword={handleResetPassword}
        onShowLogin={showLogin}
      />
    )
  }

  return <AuthLayout>{authPage}</AuthLayout>
}

export default App
