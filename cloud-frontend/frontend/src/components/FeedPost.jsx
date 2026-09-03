import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import {
  createFeedComment,
  deleteFeedComment,
  toggleFeedLike,
} from '../services/communityApi.js'
import { formatDateTime } from '../utils/format.js'

function LikeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="feed-like-icon"
      fill="none"
      focusable="false"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function FeedPost({ item, onOpen, onItemChange }) {
  const [draft, setDraft] = useState('')
  const [likeBusy, setLikeBusy] = useState(false)
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const comments = item.comments || []
  const likeCount = item.like_count || 0
  const liked = Boolean(item.liked)

  async function handleLike() {
    if (likeBusy) {
      return
    }
    setLikeBusy(true)
    try {
      const data = await toggleFeedLike(item)
      onItemChange({
        ...item,
        liked: Boolean(data.liked),
        like_count: data.like_count ?? likeCount,
      })
    } catch {
      // keep previous like state
    } finally {
      setLikeBusy(false)
    }
  }

  async function handleComment(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || commentBusy) {
      return
    }
    setCommentBusy(true)
    setCommentError('')
    try {
      const data = await createFeedComment(item, body)
      const comment = data.comment
      if (!comment) {
        throw new Error('Kommentar konnte nicht gespeichert werden.')
      }
      setDraft('')
      onItemChange({
        ...item,
        comment_count: (item.comment_count || comments.length) + 1,
        comments: [...comments, comment],
      })
    } catch (error) {
      setCommentError(error.message)
    } finally {
      setCommentBusy(false)
    }
  }

  async function handleDeleteComment() {
    if (!pendingDelete?.id || deleteBusy) {
      return
    }
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteFeedComment(pendingDelete.id)
      const nextComments = comments.filter(
        (entry) => entry.id !== pendingDelete.id,
      )
      onItemChange({
        ...item,
        comment_count: Math.max(0, (item.comment_count || comments.length) - 1),
        comments: nextComments,
      })
      setPendingDelete(null)
    } catch (error) {
      setDeleteError(error.message)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <article className="feed-post">
      <button
        aria-label={`${item.original_name} öffnen`}
        className="feed-post-media"
        onClick={onOpen}
        type="button"
      >
        {item.type === 'photo' ? (
          <img
            alt=""
            className="feed-post-image"
            decoding="async"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.opacity = '0'
            }}
            src={item.thumb_url || item.url}
          />
        ) : (
          <span className="media-video-preview">
            {item.thumb_url && (
              <img
                alt=""
                className="media-video-poster"
                decoding="async"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.remove()
                }}
                src={item.thumb_url}
              />
            )}
            <span className="media-play-badge" aria-hidden="true" />
          </span>
        )}
      </button>

      <div className="feed-post-body">
        <div className="feed-post-bar">
          <button
            aria-label={liked ? 'Gefällt mir nicht mehr' : 'Gefällt mir'}
            aria-pressed={liked}
            className={`ghost-button feed-like${liked ? ' is-active' : ''}`}
            disabled={likeBusy}
            onClick={handleLike}
            type="button"
          >
            <LikeIcon />
            <span>{likeCount}</span>
          </button>
          <p className="feed-post-meta">
            <span>Von {item.shared_by}</span>
            <span>{item.type === 'photo' ? 'Foto' : 'Video'}</span>
          </p>
        </div>
        {item.note && <p className="feed-post-note">{item.note}</p>}

        <ul className="feed-comments">
          {comments.length === 0 ? (
            <li className="feed-comment is-empty">Noch keine Kommentare.</li>
          ) : (
            comments.map((entry) => (
              <li className="feed-comment" key={entry.id}>
                <div className="feed-comment-copy">
                  <strong>{entry.username}</strong>
                  <span>{entry.body}</span>
                  {entry.created_at && (
                    <time dateTime={entry.created_at}>
                      {formatDateTime(entry.created_at)}
                    </time>
                  )}
                </div>
                {(entry.mine || item.mine) && (
                  <button
                    aria-label="Kommentar löschen"
                    className="feed-comment-delete"
                    onClick={() => {
                      setDeleteError('')
                      setPendingDelete(entry)
                    }}
                    type="button"
                  >
                    Löschen
                  </button>
                )}
              </li>
            ))
          )}
        </ul>

        <form className="feed-comment-form" onSubmit={handleComment}>
          <label className="feed-comment-field">
            <span className="folder-field-label">Kommentar</span>
            <input
              className="feed-comment-input"
              disabled={commentBusy}
              maxLength={280}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Schreiben…"
              type="text"
              value={draft}
            />
          </label>
          {commentError && <p className="form-error">{commentError}</p>}
          <button
            className="secondary-button"
            disabled={commentBusy || !draft.trim()}
            type="submit"
          >
            {commentBusy ? 'Wird gesendet…' : 'Kommentieren'}
          </button>
        </form>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          busy={deleteBusy}
          busyLabel="Wird gelöscht…"
          confirmLabel="Kommentar löschen"
          danger
          description={`Kommentar von ${pendingDelete.username} dauerhaft entfernen?`}
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) {
              setPendingDelete(null)
              setDeleteError('')
            }
          }}
          onConfirm={handleDeleteComment}
          title="Kommentar löschen"
        />
      )}
    </article>
  )
}
