import { useState } from 'react'
import { PasswordField } from '../components/PasswordField.jsx'

export function ResetPasswordPage({ error, notice, isSubmitting, onResetPassword, onShowLogin }) {
  const [username, setUsername] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
        <PasswordField
          autoComplete="new-password"
          minLength={6}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          onToggleVisible={() => setShowPassword((current) => !current)}
          placeholder="Neues Passwort"
          required
          value={password}
          visible={showPassword}
        />
      </label>

      <label>
        Passwort wiederholen
        <PasswordField
          autoComplete="new-password"
          minLength={6}
          name="passwordRepeat"
          onChange={(event) => setPasswordRepeat(event.target.value)}
          onToggleVisible={() => setShowPassword((current) => !current)}
          placeholder="Passwort wiederholen"
          required
          value={passwordRepeat}
          visible={showPassword}
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
