import { memo } from 'react'

function MediaCardBase({ item, onOpen }) {
  const isPhoto = item.type === 'photo'
  const hasPoster = Boolean(item.thumb_url)

  return (
    <article className="media-card">
      <button
        aria-label={`${item.original_name} öffnen`}
        className="media-open"
        onClick={onOpen}
        type="button"
      >
        <div className="media-frame">
          {isPhoto ? (
            <img
              alt=""
              className="media-thumb"
              decoding="async"
              loading="lazy"
              src={item.thumb_url || item.url}
            />
          ) : (
            <span className="media-video-preview">
              {hasPoster && (
                <img
                  alt=""
                  className="media-video-poster"
                  decoding="async"
                  loading="lazy"
                  src={item.thumb_url}
                />
              )}
              <span className="media-play-badge" aria-hidden="true" />
            </span>
          )}
        </div>
      </button>
      <div className="media-meta">
        <span>{isPhoto ? 'Foto' : 'Video'}</span>
        <span>{item.original_name}</span>
      </div>
    </article>
  )
}

export const MediaCard = memo(MediaCardBase)
