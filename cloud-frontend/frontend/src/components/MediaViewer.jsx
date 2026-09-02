import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const SWIPE_THRESHOLD = 56

export function MediaViewer({ items, index, onClose, onIndexChange, onDelete, deleteLabel }) {
  const touchRef = useRef({ x: 0, y: 0, tracking: false })
  const item = items[index]
  const isPhoto = item?.type === 'photo'
  const hasPrev = index > 0
  const hasNext = index < items.length - 1
  const downloadUrl = item?.download_url || `${item?.url || ''}?download=1`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        onIndexChange(index - 1)
      }
      if (event.key === 'ArrowRight' && index < items.length - 1) {
        onIndexChange(index + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [index, items.length, onClose, onIndexChange])

  if (!item) {
    return null
  }

  function goPrev() {
    if (hasPrev) {
      onIndexChange(index - 1)
    }
  }

  function goNext() {
    if (hasNext) {
      onIndexChange(index + 1)
    }
  }

  function handleTouchStart(event) {
    if (event.target.closest('video')) {
      touchRef.current.tracking = false
      return
    }
    const touch = event.changedTouches[0]
    touchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      tracking: true,
    }
  }

  function handleTouchEnd(event) {
    if (!touchRef.current.tracking) {
      return
    }
    touchRef.current.tracking = false
    const touch = event.changedTouches[0]
    const dx = touch.clientX - touchRef.current.x
    const dy = touch.clientY - touchRef.current.y

    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        goNext()
      } else {
        goPrev()
      }
      return
    }

    if (dy >= SWIPE_THRESHOLD * 1.4 && Math.abs(dy) > Math.abs(dx)) {
      onClose()
    }
  }

  return createPortal(
    <div
      aria-label={item.original_name}
      aria-modal="true"
      className="media-viewer"
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
      role="dialog"
      tabIndex={-1}
    >
      <div className="media-viewer-toolbar">
        <div className="media-viewer-heading">
          <span>{isPhoto ? 'Foto' : 'Video'}</span>
          <strong>{item.original_name}</strong>
        </div>
        <div className="media-viewer-actions">
          {item.url && (
            <a
              className="media-viewer-close"
              download={item.original_name}
              href={downloadUrl}
            >
              Download
            </a>
          )}
          {onDelete && (
            <button
              className="danger-button"
              onClick={() => onDelete(item)}
              type="button"
            >
              {deleteLabel || 'Datei löschen'}
            </button>
          )}
          <button
            aria-label="Schließen"
            autoFocus
            className="media-viewer-close"
            onClick={onClose}
            type="button"
          >
            Schließen
          </button>
        </div>
      </div>

      <div className="media-viewer-stage">
        {hasPrev && (
          <button
            aria-label="Vorherige Datei"
            className="media-viewer-nav is-prev"
            onClick={goPrev}
            type="button"
          />
        )}

        {isPhoto ? (
          <img
            alt={item.original_name}
            className="media-viewer-media"
            src={item.url}
          />
        ) : (
          <video
            autoPlay
            className="media-viewer-media"
            controls
            key={`${item.type}-${item.id}`}
            playsInline
            poster={item.thumb_url}
            preload="metadata"
            src={item.url}
          />
        )}

        {hasNext && (
          <button
            aria-label="Nächste Datei"
            className="media-viewer-nav is-next"
            onClick={goNext}
            type="button"
          />
        )}
      </div>

      <p className="media-viewer-count">
        {index + 1} von {items.length}
      </p>
    </div>,
    document.body,
  )
}
