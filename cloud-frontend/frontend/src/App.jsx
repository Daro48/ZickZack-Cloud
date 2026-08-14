import { useEffect, useState } from 'react'
import './App.css'
import { AuthLayout } from './components/AuthLayout.jsx'
import { BunchUploadPage } from './pages/BunchUploadPage.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { RegisterPage } from './pages/RegisterPage.jsx'
import { getCurrentUser, loginUser, logoutUser, registerUser } from './services/authApi.js'

function App() {
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

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

    try {
      await registerUser({ username, password })
      const data = await loginUser({ username, password })
      setUser(data.user || { username })
      setPage('home')
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
      setPage('login')
    }
  }

  function showLogin() {
    setAuthError('')
    setPage('login')
  }

  function showRegister() {
    setAuthError('')
    setPage('register')
  }

  if (isCheckingSession) {
    return (
      <AuthLayout>
        <section className="auth-card" aria-live="polite">
          <p className="eyebrow">Cloud</p>
          <h1>Laedt...</h1>
          <p className="auth-copy">Deine Session wird geprueft.</p>
        </section>
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

  return (
    <AuthLayout>
      {page === 'register' ? (
        <RegisterPage
          error={authError}
          isSubmitting={isSubmitting}
          onRegister={handleRegister}
          onShowLogin={showLogin}
        />
      ) : (
        <LoginPage
          error={authError}
          isSubmitting={isSubmitting}
          onLogin={handleLogin}
          onShowRegister={showRegister}
        />
      )}
    </AuthLayout>
  )
}

export default App
