import { memo, useState } from 'react'

function MediaCardBase({ item }) {
  const [isPlaying, setIsPlaying] = useState(false)
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
            preload="metadata"
            src={item.url}
          />
        ) : (
          <button
            className="media-thumb media-video-placeholder"
            onClick={() => setIsPlaying(true)}
            type="button"
          >
            <span className="media-video-icon" aria-hidden="true" />
            <span className="media-video-hint">Video abspielen</span>
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
