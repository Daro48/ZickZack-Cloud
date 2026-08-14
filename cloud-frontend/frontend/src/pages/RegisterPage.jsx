import { useState } from 'react'

export function RegisterPage({ error, isSubmitting, onRegister, onShowLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    onRegister({
      username: username.trim(),
      password,
    })
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <p className="eyebrow">Neues Konto</p>
      <h1>Registrierung</h1>
      <p className="auth-copy">Erstelle deinen Account und starte mit deiner eigenen Seite.</p>

      <label>
        Username
        <input
          autoComplete="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="username waehlen"
          minLength={3}
          required
          type="text"
          value={username}
        />
      </label>

      <label>
        Passwort
        <input
          autoComplete="new-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="passwort erstellen"
          minLength={6}
          required
          type="password"
          value={password}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Konto erstellen...' : 'Konto erstellen'}
      </button>

      <p className="switch-copy">
        Schon registriert?
        <button type="button" onClick={onShowLogin}>
          Zum Login
        </button>
      </p>
    </form>
  )
}
