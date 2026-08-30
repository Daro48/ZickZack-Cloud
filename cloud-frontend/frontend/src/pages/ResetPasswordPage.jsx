import { useState } from 'react'

export function ResetPasswordPage({ error, notice, isSubmitting, onResetPassword, onShowLogin }) {
  const [username, setUsername] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [localError, setLocalError] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    setLocalError('')

    if (password !== passwordRepeat) {
      setLocalError('Die Passwörter stimmen nicht überein.')
      return
    }

    onResetPassword({
      username: username.trim(),
      recoveryCode: recoveryCode.trim(),
      password,
    })
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <p className="eyebrow">Passwort</p>
      <h1>Zurücksetzen</h1>
      <p className="auth-copy">
        Gib deinen Benutzernamen und den Wiederherstellungscode ein, den du bei der Registrierung erhalten hast.
      </p>

      <label>
        Benutzername
        <input
          autoComplete="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Benutzername"
          required
          type="text"
          value={username}
        />
      </label>

      <label>
        Wiederherstellungscode
        <input
          autoComplete="one-time-code"
          name="recoveryCode"
          onChange={(event) => setRecoveryCode(event.target.value)}
          placeholder="XXXX-XXXX"
          required
          spellCheck={false}
          type="text"
          value={recoveryCode}
        />
      </label>

      <label>
        Neues Passwort
        <input
          autoComplete="new-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Neues Passwort"
          minLength={6}
          required
          type="password"
          value={password}
        />
      </label>

      <label>
        Passwort wiederholen
        <input
          autoComplete="new-password"
          name="passwordRepeat"
          onChange={(event) => setPasswordRepeat(event.target.value)}
          placeholder="Passwort wiederholen"
          minLength={6}
          required
          type="password"
          value={passwordRepeat}
        />
      </label>

      {(localError || error) && <p className="form-error">{localError || error}</p>}
      {notice && !localError && !error && <p className="form-success">{notice}</p>}

      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Wird gespeichert…' : 'Passwort speichern'}
      </button>

      <p className="switch-copy">
        Zurück zur
        <button type="button" onClick={onShowLogin}>
          Anmeldung
        </button>
      </p>
    </form>
  )
}
