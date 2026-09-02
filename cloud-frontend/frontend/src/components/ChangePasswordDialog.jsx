import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { PasswordField } from './PasswordField.jsx'
import { changePassword } from '../services/authApi.js'

export function ChangePasswordDialog({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const mismatch = Boolean(confirmPassword) && newPassword !== confirmPassword
  const confirmDisabled =
    !currentPassword || !newPassword || mismatch || newPassword.length < 6

  async function handleConfirm() {
    if (busy || confirmDisabled) {
      return
    }
    if (newPassword.length < 6) {
      setError('Das neue Passwort muss mindestens 6 Zeichen haben.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await changePassword({
        currentPassword,
        newPassword,
      })
      setDone(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <ConfirmDialog
        confirmLabel="Schließen"
        description="Dein Passwort ist gespeichert. Andere Geräte wurden abgemeldet."
        onCancel={onClose}
        onConfirm={onClose}
        title="Passwort geändert"
      />
    )
  }

  return (
    <ConfirmDialog
      busy={busy}
      confirmDisabled={confirmDisabled}
      confirmLabel="Passwort speichern"
      description="Andere angemeldete Geräte werden abgemeldet. Diese Sitzung bleibt aktiv."
      error={
        error ||
        (mismatch ? 'Die neuen Passwörter stimmen nicht überein.' : '')
      }
      onCancel={onClose}
      onConfirm={handleConfirm}
      title="Passwort ändern"
    >
      <label className="folder-field">
        <span className="folder-field-label">Aktuelles Passwort</span>
        <PasswordField
          autoComplete="current-password"
          disabled={busy}
          name="current-password"
          onChange={(event) => setCurrentPassword(event.target.value)}
          onToggleVisible={() => setVisible((current) => !current)}
          required
          value={currentPassword}
          visible={visible}
        />
      </label>
      <label className="folder-field">
        <span className="folder-field-label">Neues Passwort</span>
        <PasswordField
          autoComplete="new-password"
          disabled={busy}
          minLength={6}
          name="new-password"
          onChange={(event) => setNewPassword(event.target.value)}
          onToggleVisible={() => setVisible((current) => !current)}
          required
          value={newPassword}
          visible={visible}
        />
      </label>
      <label className="folder-field">
        <span className="folder-field-label">Neues Passwort wiederholen</span>
        <PasswordField
          autoComplete="new-password"
          disabled={busy}
          minLength={6}
          name="confirm-password"
          onChange={(event) => setConfirmPassword(event.target.value)}
          onToggleVisible={() => setVisible((current) => !current)}
          required
          value={confirmPassword}
          visible={visible}
        />
      </label>
    </ConfirmDialog>
  )
}
