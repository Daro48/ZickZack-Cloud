import { useMemo, useRef, useState } from 'react'
import { FolderPicker } from '../components/FolderPicker.jsx'
import { TimelinePicker, MONTH_NAMES } from '../components/TimelinePicker.jsx'
import { Topbar } from '../components/Topbar.jsx'
import { fetchWeekMedia, uploadMedia } from '../services/mediaApi.js'

function buildYears() {
  const currentYear = new Date().getFullYear()
  return Array.from({ length: 5 }, (_, index) => currentYear + index)
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function buildWeeks(year, month) {
  if (!year || !month) {
    return []
  }

  const lastDay = daysInMonth(year, month)
  const weekCount = Math.ceil(lastDay / 7)

  return Array.from({ length: weekCount }, (_, index) => {
    const week = index + 1
    const startDay = index * 7 + 1
    const endDay = Math.min(week * 7, lastDay)
    return {
      week,
      label: `${startDay}. – ${endDay}.`,
    }
  })
}

function currentSelection() {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    week: Math.floor((now.getDate() - 1) / 7) + 1,
  }
}

export function HomePage({ username, onLogout, onGoBunch }) {
  const fileInputRef = useRef(null)
  const years = useMemo(() => buildYears(), [])
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => index + 1),
    [],
  )

  const [selectedFolder, setSelectedFolder] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')

  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [openPanel, setOpenPanel] = useState('year')

  const [items, setItems] = useState([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isLoadingMedia, setIsLoadingMedia] = useState(false)
  const [timelineError, setTimelineError] = useState('')

  const weeks = useMemo(
    () => buildWeeks(Number(selectedYear), Number(selectedMonth)),
    [selectedYear, selectedMonth],
  )

  const selectedWeekMeta = weeks.find(
    (entry) => Number(entry.week) === Number(selectedWeek),
  )

  async function loadMedia(year, month, week) {
    if (!year || !month || !week) {
      return
    }

    setIsLoadingMedia(true)
    setTimelineError('')
    setHasLoaded(true)

    try {
      const data = await fetchWeekMedia(year, month, week)
      setItems(data.items || [])
    } catch (error) {
      setTimelineError(error.message)
      setItems([])
    } finally {
      setIsLoadingMedia(false)
    }
  }

  function openFilePicker() {
    if (!selectedFolder) {
      setUploadError('Bitte zuerst einen Ordner wählen oder erstellen.')
      return
    }
    fileInputRef.current?.click()
  }

  async function handleFilesSelected(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    if (!selectedFolder) {
      setUploadError('Bitte zuerst einen Ordner wählen oder erstellen.')
      return
    }

    setIsUploading(true)
    setUploadMessage('')
    setUploadError('')

    try {
      const data = await uploadMedia(files, { folder: selectedFolder })
      setUploadMessage(
        data.message
          ? `${data.message} Ordner: ${selectedFolder}`
          : 'Upload fertig.',
      )
      if (data.errors?.length) {
        setUploadError(
          `${data.errors.length} Datei(en) konnten nicht hochgeladen werden.`,
        )
      }

      const selection = currentSelection()
      setSelectedYear(String(selection.year))
      setSelectedMonth(String(selection.month))
      setSelectedWeek(String(selection.week))
      setOpenPanel(null)
      await loadMedia(selection.year, selection.month, selection.week)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setIsUploading(false)
    }
  }

  function handleTogglePanel(panel) {
    setOpenPanel((current) => (current === panel ? null : panel))
  }

  function handleSelectYear(year) {
    setSelectedYear(String(year))
    setSelectedMonth('')
    setSelectedWeek('')
    setItems([])
    setHasLoaded(false)
    setTimelineError('')
    setOpenPanel('month')
  }

  function handleSelectMonth(month) {
    setSelectedMonth(String(month))
    setSelectedWeek('')
    setItems([])
    setHasLoaded(false)
    setTimelineError('')
    setOpenPanel('week')
  }

  async function handleSelectWeek(week) {
    setSelectedWeek(String(week))
    setOpenPanel(null)
    setItems([])
    setHasLoaded(false)
    setTimelineError('')
    await loadMedia(Number(selectedYear), Number(selectedMonth), Number(week))
  }

  return (
    <div className="app-shell">
      <Topbar
        username={username}
        center={
          <nav className="topbar-nav" aria-label="Hauptnavigation">
            <button className="nav-link is-active" type="button">
              Home
            </button>
            <button
              className="nav-link"
              onClick={onGoBunch}
              type="button"
            >
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

      <main className="home-page">
        <header className="home-header">
          <div>
            <p className="eyebrow">Deine Cloud</p>
            <h1>{username}</h1>
          </div>
        </header>

        <FolderPicker
          disabled={isUploading}
          folder={selectedFolder}
          onFolderChange={setSelectedFolder}
          username={username}
        />

        <section className="home-upload" aria-label="Schnell-Upload">
          <input
            ref={fileInputRef}
            accept="image/*,video/*,.heic,.heif,.mov,.mp4,.m4v,.webm,.3gp"
            className="upload-input"
            multiple
            onChange={handleFilesSelected}
            type="file"
          />
          <button
            className="primary-button upload-button"
            disabled={isUploading || !selectedFolder}
            onClick={openFilePicker}
            type="button"
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </section>

        {(uploadMessage || uploadError) && (
          <section className="upload-status" aria-live="polite">
            {uploadMessage && <p className="upload-ok">{uploadMessage}</p>}
            {uploadError && <p className="form-error">{uploadError}</p>}
          </section>
        )}

        <TimelinePicker
          months={months}
          onSelectMonth={handleSelectMonth}
          onSelectWeek={handleSelectWeek}
          onSelectYear={handleSelectYear}
          onTogglePanel={handleTogglePanel}
          openPanel={openPanel}
          selectedMonth={selectedMonth}
          selectedWeek={selectedWeek}
          selectedYear={selectedYear}
          weeks={weeks}
          years={years}
        />

        {timelineError && (
          <section className="upload-status">
            <p className="form-error">{timelineError}</p>
          </section>
        )}

        <section className="media-section" aria-label="Medien der Woche">
          {selectedWeekMeta && (
            <div className="media-heading-row">
              <p className="media-heading">
                {MONTH_NAMES[Number(selectedMonth) - 1]} {selectedYear}
              </p>
              <p className="media-subheading">
                Woche {selectedWeek} · {selectedWeekMeta.label}
              </p>
            </div>
          )}

          {isLoadingMedia ? (
            <p className="empty-home">Lädt…</p>
          ) : !hasLoaded ? (
            <div className="empty-panel">
              <p>Jahr, Monat und Woche wählen.</p>
              <span>Fotos und Videos erscheinen erst nach der Wochenwahl.</span>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-panel">
              <p>Diese Woche ist noch leer.</p>
              <span>Lade oben etwas hoch, dann erscheint es hier.</span>
            </div>
          ) : (
            <div className="media-grid">
              {items.map((item) => (
                <article className="media-card" key={`${item.type}-${item.id}`}>
                  <div className="media-frame">
                    {item.type === 'photo' ? (
                      <img
                        alt={item.original_name}
                        className="media-thumb"
                        loading="lazy"
                        src={item.url}
                      />
                    ) : (
                      <video
                        className="media-thumb"
                        controls
                        preload="metadata"
                        src={item.url}
                      />
                    )}
                  </div>
                  <div className="media-meta">
                    <span>{item.type === 'photo' ? 'Foto' : 'Video'}</span>
                    <span>{item.original_name}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
