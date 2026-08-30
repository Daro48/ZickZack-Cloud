import { useState } from 'react'

export function RecoveryCodePage({ recoveryCode, onContinue }) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(recoveryCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Wichtig</p>
      <h1>Wiederherstellungscode</h1>
      <p className="auth-copy">
        Bewahre diesen Code sicher auf. Damit kannst du später dein Passwort zurücksetzen.
      </p>

      <p className="recovery-code">{recoveryCode}</p>

      <button className="secondary-button" onClick={copyCode} type="button">
        {copied ? 'Kopiert' : 'Code kopieren'}
      </button>

      <button className="primary-button" onClick={onContinue} type="button">
        Weiter zur Cloud
      </button>
    </section>
  )
}
