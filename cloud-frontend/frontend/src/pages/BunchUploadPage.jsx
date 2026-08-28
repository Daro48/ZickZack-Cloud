import { useMemo, useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { uploadMedia } from '../services/mediaApi.js'
import { isAllowedMediaFile } from '../utils/mediaTypes.js'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createQueueItem(file) {
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${uid}`,
    file,
    name: file.name || 'Datei',
    size: file.size,
    status: 'pending',
    message: '',
    progress: 0,
    loadedBytes: 0,
  }
}

function collectFilesFromDataTransfer(dataTransfer) {
  const files = []
  if (dataTransfer?.files?.length) {
    files.push(...Array.from(dataTransfer.files))
  }
  return files.filter(isAllowedMediaFile)
}

export function BunchUploadPage({ username, onLogout, onGoHome }) {
  const fileInputRef = useRef(null)
  const [selectedFolder, setSelectedFolder] = useState('')
  const [queue, setQueue] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [summary, setSummary] = useState('')
  const [activeBatchIds, setActiveBatchIds] = useState([])

  const counts = useMemo(() => {
    const pending = queue.filter((item) => item.status === 'pending').length
    const uploading = queue.filter((item) => item.status === 'uploading').length
    const done = queue.filter((item) => item.status === 'done').length
    const failed = queue.filter((item) => item.status === 'error').length
    return { pending, uploading, done, failed, total: queue.length }
  }, [queue])

  const batchItems = useMemo(() => {
    if (activeBatchIds.length === 0) {
      return []
    }
    const idSet = new Set(activeBatchIds)
    return queue.filter((item) => idSet.has(item.id))
  }, [activeBatchIds, queue])

  const overallProgress = useMemo(() => {
    const source = batchItems.length > 0 ? batchItems : queue
    if (source.length === 0) {
      return { percent: 0, loaded: 0, total: 0, doneCount: 0, totalCount: 0 }
    }

    let loaded = 0
    let total = 0
    let doneCount = 0

    for (const item of source) {
      total += item.size
      if (item.status === 'done' || item.status === 'error') {
        loaded += item.size
        doneCount += 1
      } else if (item.status === 'uploading') {
        loaded += Math.min(item.loadedBytes || 0, item.size)
      }
    }

    const percent =
      total === 0 ? 0 : Math.min(100, Math.round((loaded / total) * 100))

    return {
      percent,
      loaded,
      total,
      doneCount,
      totalCount: source.length,
    }
  }, [batchItems, queue])

  function addFiles(fileList) {
    const selected = Array.from(fileList || [])
    const incoming = selected.filter(isAllowedMediaFile).map(createQueueItem)

    if (incoming.length === 0) {
      if (selected.length > 0) {
        setSummary('Keine gültigen Fotos/Videos erkannt. Bitte erneut wählen.')
      }
      return
    }

    setSummary(`${incoming.length} Datei(en) hinzugefügt — jetzt Upload starten.`)
    setQueue((current) => [...current, ...incoming])
  }

  function openFilePicker() {
    if (isUploading) {
      return
    }
    fileInputRef.current?.click()
  }

  function handleFilesSelected(event) {
    addFiles(event.target.files)
    event.target.value = ''
  }

  function handleDragEnter(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!isUploading) {
      setIsDragging(true)
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!isUploading) {
      setIsDragging(true)
    }
  }

  function handleDragLeave(event) {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    setIsDragging(false)
  }

  function handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    if (isUploading) {
      return
    }
    addFiles(collectFilesFromDataTransfer(event.dataTransfer))
  }

  function removeItem(id) {
    if (isUploading) {
      return
    }
    setQueue((current) => current.filter((item) => item.id !== id))
  }

  function clearQueue() {
    if (isUploading) {
      return
    }
    setQueue([])
    setSummary('')
    setActiveBatchIds([])
  }

  function clearFinished() {
    if (isUploading) {
      return
    }
    setQueue((current) =>
      current.filter((item) => item.status !== 'done' && item.status !== 'error'),
    )
    setSummary('')
    setActiveBatchIds([])
  }

  function updateItem(id, patch) {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  async function runUpload(items) {
    if (items.length === 0 || isUploading) {
      return
    }

    if (!selectedFolder) {
      setSummary('Bitte zuerst einen Ordner wählen oder erstellen.')
      return
    }

    const batchIds = items.map((item) => item.id)
    setIsUploading(true)
    setSummary('')
    setActiveBatchIds(batchIds)

    setQueue((current) =>
      current.map((item) =>
        batchIds.includes(item.id)
          ? {
              ...item,
              status: 'pending',
              message: '',
              progress: 0,
              loadedBytes: 0,
            }
          : item,
      ),
    )

    const files = items.map((item) => ({
      queueId: item.id,
      file: item.file,
    }))

    try {
      const data = await uploadMedia(files, {
        folder: selectedFolder,
        onFileStart(queueId) {
          updateItem(queueId, {
            status: 'uploading',
            message: '',
            progress: 0,
            loadedBytes: 0,
          })
        },
        onFileProgress(queueId, file, loaded, total) {
          const safeTotal = total || file.size || 1
          const percent = Math.min(
            100,
            Math.round((loaded / safeTotal) * 100),
          )
          updateItem(queueId, {
            status: 'uploading',
            progress: percent,
            loadedBytes: Math.min(loaded, file.size),
            message: `${percent}%`,
          })
        },
        onFileDone(queueId, file) {
          updateItem(queueId, {
            status: 'done',
            message: 'Fertig',
            progress: 100,
            loadedBytes: file.size,
          })
        },
        onFileError(queueId, _file, message) {
          updateItem(queueId, {
            status: 'error',
            message,
            progress: 0,
          })
        },
      })

      const failedCount = data.errors?.length || 0
      setSummary(
        failedCount > 0
          ? `${data.uploaded.length} hochgeladen nach ${selectedFolder}, ${failedCount} fehlgeschlagen.`
          : `${data.uploaded.length} Datei(en) hochgeladen nach ${selectedFolder}.`,
      )
    } catch (error) {
      setSummary(error.message || 'Upload fehlgeschlagen.')
    } finally {
      setIsUploading(false)
    }
  }

  async function startUpload() {
    const pending = queue.filter((item) => item.status === 'pending')
    await runUpload(pending)
  }

  async function retryFailed() {
    const failed = queue.filter((item) => item.status === 'error')
    await runUpload(failed)
  }

  const showProgressPanel = counts.total > 0
  const activeLabel = isUploading
    ? `Datei ${Math.min(overallProgress.doneCount + 1, overallProgress.totalCount)} von ${overallProgress.totalCount}`
    : `${counts.done + counts.failed}/${counts.total} Dateien`

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        center={
          <nav className="topbar-nav" aria-label="Hauptnavigation">
            <button
              className="nav-link"
              onClick={onGoHome}
              type="button"
            >
              Home
            </button>
            <button className="nav-link is-active" type="button">
              Bunch Upload
            </button>
          </nav>
        }
        action={
          <button className="secondary-button" type="button" onClick={onLogout}>
            Logout
          </button>
        }
      />

      <main className="home-page bunch-page">
        <header className="home-header">
          <div>
            <p className="eyebrow">Massen-Upload</p>
            <h1>Bunch Upload</h1>
          </div>
        </header>

        <FolderPicker
          disabled={isUploading}
          folder={selectedFolder}
          onFolderChange={setSelectedFolder}
          username={username}
        />

        {showProgressPanel && (
          <section
            className={`bunch-progress-panel${isUploading ? ' is-active' : ''}`}
            aria-label="Upload-Fortschritt"
          >
            <div className="bunch-progress-head">
              <div className="bunch-stats">
                <span>{activeLabel}</span>
                <span>{overallProgress.percent}%</span>
                <span>
                  {formatBytes(overallProgress.loaded)} /{' '}
                  {formatBytes(overallProgress.total)}
                </span>
                {counts.failed > 0 && (
                  <span className="bunch-stat-error">
                    {counts.failed} Fehler
                  </span>
                )}
              </div>
              {isUploading && (
                <span className="bunch-progress-live">Upload läuft…</span>
              )}
            </div>

            <div
              className="bunch-progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={overallProgress.percent}
              role="progressbar"
            >
              <div
                className="bunch-progress-bar"
                style={{ width: `${overallProgress.percent}%` }}
              />
            </div>
          </section>
        )}

        <section className="bunch-section" aria-label="Dateien hinzufügen">
          <input
            ref={fileInputRef}
            accept="image/*,video/*,.heic,.heif,.mov,.mp4,.m4v,.webm,.3gp"
            className="upload-input"
            multiple
            onChange={handleFilesSelected}
            type="file"
          />

          <button
            className={`dropzone${isDragging ? ' is-dragging' : ''}${isUploading ? ' is-disabled' : ''}`}
            disabled={isUploading}
            onClick={openFilePicker}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            type="button"
          >
            <span className="dropzone-title">
              Dateien hierher ziehen oder klicken
            </span>
            <span className="dropzone-copy">
              Fotos und Videos — beliebige Anzahl. Danach unten Upload starten.
            </span>
          </button>

          {summary && counts.total === 0 && (
            <p className="form-error">{summary}</p>
          )}
        </section>

        {counts.total > 0 && (
          <section className="bunch-section" aria-label="Upload-Warteschlange">
            <p className="bunch-queue-count">
              {counts.pending} wartend
              {counts.uploading > 0 ? ` · ${counts.uploading} aktiv` : ''}
              {counts.done > 0 ? ` · ${counts.done} fertig` : ''}
              {counts.failed > 0 ? ` · ${counts.failed} Fehler` : ''}
            </p>
            <ul className="bunch-queue">
              {queue.map((item) => (
                <li className={`bunch-item status-${item.status}`} key={item.id}>
                  <div className="bunch-item-main">
                    <span className="bunch-item-name">{item.name}</span>
                    <span className="bunch-item-size">
                      {formatBytes(item.size)}
                      {item.status === 'uploading' &&
                        ` · ${formatBytes(item.loadedBytes)}`}
                    </span>
                    {(item.status === 'uploading' || item.progress > 0) && (
                      <div className="bunch-item-progress">
                        <div
                          className="bunch-item-progress-bar"
                          style={{
                            width: `${
                              item.status === 'done'
                                ? 100
                                : item.status === 'error'
                                  ? 0
                                  : item.progress
                            }%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="bunch-item-side">
                    <span className="bunch-item-status">
                      {item.status === 'pending' && 'Wartend'}
                      {item.status === 'uploading' && `${item.progress}%`}
                      {item.status === 'done' && 'Fertig'}
                      {item.status === 'error' && (item.message || 'Fehler')}
                    </span>
                    {!isUploading && item.status !== 'uploading' && (
                      <button
                        className="bunch-remove"
                        onClick={() => removeItem(item.id)}
                        type="button"
                      >
                        Entfernen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {counts.total > 0 && (
        <section className="bunch-action-bar" aria-label="Upload-Aktionen">
          <div className="bunch-actions">
            <button
              className="primary-button upload-button"
              disabled={isUploading || counts.pending === 0 || !selectedFolder}
              onClick={startUpload}
              type="button"
            >
              {isUploading
                ? 'Uploading...'
                : `Upload starten (${counts.pending})`}
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.failed === 0}
              onClick={retryFailed}
              type="button"
            >
              Fehler erneut
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.total === 0}
              onClick={clearFinished}
              type="button"
            >
              Fertige entfernen
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.total === 0}
              onClick={clearQueue}
              type="button"
            >
              Leeren
            </button>
          </div>

          {summary && (
            <p className={counts.failed > 0 ? 'form-error' : 'upload-ok'}>
              {summary}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
