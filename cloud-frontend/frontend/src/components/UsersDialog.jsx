import { useEffect, useState } from 'react'
import { fetchAdminUsers } from '../services/adminApi.js'
import { formatPresence } from '../utils/format.js'
import { ConfirmDialog } from './ConfirmDialog.jsx'

export function UsersDialog({ onClose }) {
  const [users, setUsers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadUsers() {
    setIsLoading(true)
    setError('')
    try {
      const data = await fetchAdminUsers()
      setUsers(data.users || [])
    } catch (loadError) {
      setError(loadError.message)
      setUsers([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  return (
    <ConfirmDialog
      cancelLabel="Schließen"
      description="Zuletzt aktiv."
      hideConfirm
      onCancel={onClose}
      onConfirm={onClose}
      title="User"
    >
      {isLoading ? (
        <p className="account-messages-status">User werden geladen.</p>
      ) : error ? (
        <div className="account-messages">
          <p className="form-error">{error}</p>
          <button className="ghost-button" onClick={loadUsers} type="button">
            Erneut laden
          </button>
        </div>
      ) : users.length === 0 ? (
        <p className="account-messages-status">Keine User.</p>
      ) : (
        <div className="account-messages" aria-label="User">
          {users.map((entry) => {
            const presence = formatPresence(entry.last_seen_at)
            const isOnline = presence === 'Online'
            return (
              <article className="user-presence" key={entry.id}>
                <strong>{entry.username}</strong>
                <span className={isOnline ? 'user-presence-status is-online' : 'user-presence-status'}>
                  {presence}
                </span>
              </article>
            )
          })}
        </div>
      )}
    </ConfirmDialog>
  )
}
