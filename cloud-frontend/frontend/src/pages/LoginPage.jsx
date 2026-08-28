import { useState } from 'react'

export function LoginPage({ error, notice, isSubmitting, onLogin, onShowRegister, onShowResetPassword }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    onLogin({
      username: username.trim(),
      password,
    })
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <p className="eyebrow">Willkommen</p>
      <h1>Login</h1>
      <p className="auth-copy">Melde dich an, um deine Cloud zu sehen.</p>

      <label>
        Username
        <input
          autoComplete="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="dein username"
          required
          type="text"
          value={username}
        />
      </label>

      <label>
        Passwort
        <input
          autoComplete="current-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="dein passwort"
          required
          type="password"
          value={password}
        />
      </label>

      {error && <p className="form-error">{error}</p>}
      {notice && !error && <p className="form-success">{notice}</p>}

      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Einloggen...' : 'Einloggen'}
      </button>

      <p className="switch-copy">
        Noch kein Konto?
        <button type="button" onClick={onShowRegister}>
          Registrieren
        </button>
      </p>

      <p className="switch-copy">
        Passwort vergessen?
        <button type="button" onClick={onShowResetPassword}>
          Zurücksetzen
        </button>
      </p>
    </form>
  )
}
