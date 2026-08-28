import { useEffect, useState } from 'react'
import './App.css'
import { AuthLayout } from './components/AuthLayout.jsx'
import { BunchUploadPage } from './pages/BunchUploadPage.jsx'
import { HomePage } from './pages/HomePage.jsx'
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

function App() {
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [recoveryCode, setRecoveryCode] = useState('')

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

  if (page === 'home' && user) {
    return (
      <HomePage
        username={user.username}
        onLogout={handleLogout}
        onGoBunch={() => setPage('bunch')}
      />
    )
  }

  if (page === 'bunch' && user) {
    return (
      <BunchUploadPage
        username={user.username}
        onLogout={handleLogout}
        onGoHome={() => setPage('home')}
      />
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
