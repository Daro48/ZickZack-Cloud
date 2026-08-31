import { memo, useState } from 'react'

function MediaCardBase({ item }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasPoster, setHasPoster] = useState(Boolean(item.thumb_url))
  const isPhoto = item.type === 'photo'

  return (
    <article className="media-card">
      <div className="media-frame">
        {isPhoto ? (
          <img
            alt={item.original_name}
            className="media-thumb"
            decoding="async"
            loading="lazy"
            src={item.thumb_url || item.url}
          />
        ) : isPlaying ? (
          <video
            autoPlay
            className="media-thumb"
            controls
            playsInline
            poster={hasPoster ? item.thumb_url : undefined}
            preload="metadata"
            src={item.url}
          />
        ) : (
          <button
            aria-label={`${item.original_name} abspielen`}
            className="media-video-preview"
            onClick={() => setIsPlaying(true)}
            type="button"
          >
            {hasPoster && (
              <img
                alt=""
                className="media-video-poster"
                decoding="async"
                loading="lazy"
                onError={() => setHasPoster(false)}
                src={item.thumb_url}
              />
            )}
            <span className="media-play-badge" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="media-meta">
        <span>{isPhoto ? 'Foto' : 'Video'}</span>
        <span>{item.original_name}</span>
      </div>
    </article>
  )
}

export const MediaCard = memo(MediaCardBase)
