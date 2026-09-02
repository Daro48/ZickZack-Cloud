import { useState } from 'react'
import { PasswordField } from '../components/PasswordField.jsx'

export function RegisterPage({ error, isSubmitting, onRegister, onShowLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

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
      <p className="auth-copy">Erstelle dein Konto und starte mit deiner Cloud.</p>

      <label>
        Benutzername
        <input
          autoComplete="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Benutzername"
          minLength={3}
          required
          type="text"
          value={username}
        />
      </label>

      <label>
        Passwort
        <PasswordField
          autoComplete="new-password"
          minLength={6}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          onToggleVisible={() => setShowPassword((current) => !current)}
          placeholder="Passwort"
          required
          value={password}
          visible={showPassword}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Konto wird erstellt…' : 'Konto erstellen'}
      </button>

      <p className="switch-copy">
        Schon registriert?
        <button type="button" onClick={onShowLogin}>
          Zur Anmeldung
        </button>
      </p>
    </form>
  )
}
