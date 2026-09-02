import { useMemo, useRef, useState } from 'react'
import { AppNav } from '../components/AppNav.jsx'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { abortActiveUploads, uploadMedia } from '../services/mediaApi.js'
import { formatBytes } from '../utils/format.js'
import { isAllowedMediaFile } from '../utils/mediaTypes.js'

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

export function HomePage({
  username,
  onLogout,
  onGoStart,
  onGoUpload,
  onGoContent,
  onGoCommunity,
}) {
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
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
      if (item.status === 'done') {
        loaded += item.size
        doneCount += 1
      } else if (item.status === 'error') {
        loaded += Math.min(item.loadedBytes || 0, item.size)
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

        setSummary(`${incoming.length} Datei(en) hinzugefügt. Jetzt den Upload starten.`)
    setQueue((current) => [...current, ...incoming])
  }

  function openFilePicker() {
    if (isUploading) {
      return
    }
    fileInputRef.current?.click()
  }

  function openCameraPicker() {
    if (isUploading) {
      return
    }
    cameraInputRef.current?.click()
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
        onFileStart(queueId, file) {
          updateItem(queueId, {
            status: 'uploading',
            message: '',
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
        onGoHome={onGoStart}
        onGoCommunity={onGoCommunity}
        center={
          <AppNav current="home" onNavigate={(page) => {
            if (page === 'content') onGoContent()
            if (page === 'community') onGoCommunity()
            if (page === 'home') onGoUpload()
          }} />
        }
        action={
          <button className="secondary-button" type="button" onClick={onLogout}>
            Abmelden
          </button>
        }
      />

      <main className="app-page upload-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Cloud</p>
            <h1>Upload</h1>
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
            className={`upload-progress-panel${isUploading ? ' is-active' : ''}`}
            aria-label="Upload-Fortschritt"
          >
            <div className="upload-progress-head">
              <div className="upload-stats">
                <span>{activeLabel}</span>
                <span>{overallProgress.percent}%</span>
                <span>
                  {formatBytes(overallProgress.loaded)} /{' '}
                  {formatBytes(overallProgress.total)}
                </span>
                {counts.failed > 0 && (
                  <span className="upload-stat-error">
                    {counts.failed} Fehler
                  </span>
                )}
              </div>
              {isUploading && (
                <button
                  className="ghost-button"
                  onClick={abortActiveUploads}
                  type="button"
                >
                  Upload abbrechen
                </button>
              )}
            </div>

            <div
              className="upload-progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={overallProgress.percent}
              role="progressbar"
            >
              <div
                className="upload-progress-bar"
                style={{ width: `${overallProgress.percent}%` }}
              />
            </div>
          </section>
        )}

        <section className="upload-section" aria-label="Dateien hinzufügen">
          <input
            ref={fileInputRef}
            accept="image/*,video/*,.heic,.heif,.mov,.mp4,.m4v,.webm,.3gp"
            className="upload-input"
            multiple
            onChange={handleFilesSelected}
            type="file"
          />
          <input
            ref={cameraInputRef}
            accept="image/*,video/*"
            capture="environment"
            className="upload-input"
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
              Dateien hierher ziehen oder auswählen
            </span>
            <span className="dropzone-copy">
              Fotos und Videos. Anschließend den Upload starten.
            </span>
          </button>

          <button
            className="secondary-button camera-button"
            disabled={isUploading}
            onClick={openCameraPicker}
            type="button"
          >
            Kamera
          </button>

          {summary && counts.total === 0 && (
            <p className="form-error">{summary}</p>
          )}
        </section>

        {counts.total > 0 && (
          <section className="upload-section" aria-label="Upload-Warteschlange">
            <p className="upload-queue-count">
              {counts.pending} wartend
              {counts.uploading > 0 ? ` · ${counts.uploading} aktiv` : ''}
              {counts.done > 0 ? ` · ${counts.done} fertig` : ''}
              {counts.failed > 0 ? ` · ${counts.failed} Fehler` : ''}
            </p>
            <ul className="upload-queue">
              {queue.map((item) => (
                <li className={`upload-item status-${item.status}`} key={item.id}>
                  <div className="upload-item-main">
                    <span className="upload-item-name">{item.name}</span>
                    <span className="upload-item-size">
                      {formatBytes(item.size)}
                      {item.status === 'uploading' &&
                        ` · ${formatBytes(item.loadedBytes)}`}
                    </span>
                    {(item.status === 'uploading' || item.progress > 0) && (
                      <div className="upload-item-progress">
                        <div
                          className="upload-item-progress-bar"
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
                  <div className="upload-item-side">
                    <span className="upload-item-status">
                      {item.status === 'pending' && 'Wartend'}
                      {item.status === 'uploading' && `${item.progress}%`}
                      {item.status === 'done' && 'Fertig'}
                      {item.status === 'error' && (item.message || 'Fehler')}
                    </span>
                    {!isUploading && item.status !== 'uploading' && (
                      <button
                        className="upload-remove"
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
        <section className="upload-action-bar" aria-label="Upload-Aktionen">
          <div className="upload-actions">
            <button
              className="primary-button upload-button"
              disabled={isUploading || counts.pending === 0 || !selectedFolder}
              onClick={startUpload}
              type="button"
            >
              {isUploading
                ? 'Wird hochgeladen…'
                : `Upload starten (${counts.pending})`}
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.failed === 0}
              onClick={retryFailed}
              type="button"
            >
              Fortsetzen
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.total === 0}
              onClick={clearFinished}
              type="button"
            >
              Abgeschlossene entfernen
            </button>
            <button
              className="secondary-button"
              disabled={isUploading || counts.total === 0}
              onClick={clearQueue}
              type="button"
            >
              Liste leeren
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
