import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Abbrechen',
  danger = false,
  busy = false,
  confirmDisabled = false,
  error = '',
  children,
  onCancel,
  onConfirm,
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, onCancel])

  function handleBackdrop(event) {
    if (event.target === event.currentTarget && !busy) {
      onCancel()
    }
  }

  return createPortal(
    <div
      aria-labelledby="confirm-dialog-title"
      aria-modal="true"
      className="share-dialog"
      onMouseDown={handleBackdrop}
      role="alertdialog"
    >
      <form
        className="share-dialog-panel"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && !confirmDisabled) {
            onConfirm()
          }
        }}
      >
        <div className="share-dialog-toolbar">
          <div className="share-dialog-heading">
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button
            className="ghost-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
        </div>

        {description && <p className="share-dialog-copy">{description}</p>}
        {children}
        {error && <p className="form-error">{error}</p>}

        <button
          className={danger ? 'danger-button share-dialog-submit' : 'primary-button share-dialog-submit'}
          disabled={busy || confirmDisabled}
          type="submit"
        >
          {busy ? 'Wird ausgeführt…' : confirmLabel}
        </button>
      </form>
    </div>,
    document.body,
  )
}
