import { useEffect, useState } from 'react'
import './App.css'
import { AuthLayout } from './components/AuthLayout.jsx'
import { HomePage } from './pages/HomePage.jsx'
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

const PAGE_TITLES = {
  login: 'Anmelden',
  register: 'Registrieren',
  'reset-password': 'Passwort zurücksetzen',
  'recovery-code': 'Wiederherstellungscode',
  home: 'Upload',
  content: 'Inhalte',
  community: 'Community',
}

function App() {
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [seenPages, setSeenPages] = useState({
    home: true,
    content: false,
    community: false,
  })

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        const data = await getCurrentUser()

        if (isMounted) {
          setUser(data.user)
          setPage('home')
        }
      } catch {
        if (isMounted) {
          setUser(null)
          setPage('login')
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

  function openPage(nextPage) {
    setSeenPages((current) =>
      nextPage in current ? { ...current, [nextPage]: true } : current,
    )
    setPage(nextPage)
  }

  async function handleLogin({ username, password }) {
    setIsSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    try {
      const data = await loginUser({ username, password })
      setUser(data.user || { username })
      setPage('home')
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
      setPage(registerData.recovery_code ? 'recovery-code' : 'home')
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
      setPage('login')
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
      setSeenPages({ home: true, content: false, community: false })
      setPage('login')
    }
  }

  function showLogin() {
    setAuthError('')
    setAuthNotice('')
    setPage('login')
  }

  function showRegister() {
    setAuthError('')
    setAuthNotice('')
    setPage('register')
  }

  function showResetPassword() {
    setAuthError('')
    setAuthNotice('')
    setPage('reset-password')
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
            setPage('home')
          }}
        />
      </AuthLayout>
    )
  }

  if (user && (page === 'home' || page === 'content' || page === 'community')) {
    return (
      <>
        <div hidden={page !== 'home'}>
          <HomePage
            username={user.username}
            onLogout={handleLogout}
            onGoHome={() => openPage('home')}
            onGoContent={() => openPage('content')}
            onGoCommunity={() => openPage('community')}
          />
        </div>
        {seenPages.content && (
          <div hidden={page !== 'content'}>
            <ViewContent
              username={user.username}
              onLogout={handleLogout}
              onGoHome={() => openPage('home')}
              onGoUpload={() => openPage('home')}
              onGoCommunity={() => openPage('community')}
            />
          </div>
        )}
        {seenPages.community && (
          <div hidden={page !== 'community'}>
            <Community
              username={user.username}
              onLogout={handleLogout}
              onGoHome={() => openPage('home')}
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
