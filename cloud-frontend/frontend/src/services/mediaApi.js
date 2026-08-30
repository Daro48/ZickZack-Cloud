const UPLOAD_CONCURRENCY = 3

function uploadSingleFile(file, { folder, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('files', file)
    if (folder) {
      formData.append('folder', folder)
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/bp/media/upload')
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.timeout = 60 * 60 * 1000

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }
      onProgress?.(event.loaded, event.total || file.size)
    }

    xhr.onload = () => {
      const data =
        xhr.response && typeof xhr.response === 'object'
          ? xhr.response
          : (() => {
              try {
                return JSON.parse(xhr.responseText || '{}')
              } catch {
                return {}
              }
            })()

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size, file.size)
        resolve(data)
        return
      }

      reject(new Error(data.message || `Upload fehlgeschlagen: ${file.name}`))
    }

    xhr.onerror = () => {
      reject(new Error(`Netzwerkfehler: ${file.name}`))
    }

    xhr.ontimeout = () => {
      reject(new Error(`Timeout: ${file.name}`))
    }

    xhr.onabort = () => {
      reject(new Error(`Abgebrochen: ${file.name}`))
    }

    xhr.send(formData)
  })
}

function normalizeQueue(files) {
  return Array.from(files).map((entry, index) => {
    if (entry && typeof entry === 'object' && entry.file instanceof File) {
      return {
        queueId: entry.queueId ?? entry.id ?? index,
        file: entry.file,
      }
    }
    return {
      queueId: entry?.queueId ?? index,
      file: entry,
    }
  })
}

export async function fetchFolders() {
  const response = await fetch('/bp/media/folders', {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Ordner konnten nicht geladen werden.')
  }

  return data
}

export async function createFolder(folder) {
  const response = await fetch('/bp/media/folders', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folder }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Ordner konnte nicht erstellt werden.')
  }

  return data
}

export async function uploadMedia(files, options = {}) {
  const { folder, onFileStart, onFileProgress, onFileDone, onFileError } = options

  if (!folder || !String(folder).trim()) {
    throw new Error('Bitte zuerst einen Ordner wählen oder erstellen.')
  }

  const fileList = normalizeQueue(files)
  const uploaded = []
  const errors = []
  let index = 0

  async function worker() {
    while (index < fileList.length) {
      const current = index
      index += 1
      const { queueId, file } = fileList[current]

      onFileStart?.(queueId, file)

      try {
        const data = await uploadSingleFile(file, {
          folder,
          onProgress(loaded, total) {
            onFileProgress?.(queueId, file, loaded, total)
          },
        })

        if (data.uploaded?.length) {
          uploaded.push(...data.uploaded)
          onFileDone?.(queueId, file, data)
        }

        if (data.errors?.length) {
          for (const entry of data.errors) {
            errors.push(entry)
          }
          if (!data.uploaded?.length) {
            onFileError?.(
              queueId,
              file,
              data.errors[0]?.message || 'Upload fehlgeschlagen.',
            )
          }
        } else if (!data.uploaded?.length) {
          const message = 'Upload fehlgeschlagen.'
          errors.push({ filename: file.name, message })
          onFileError?.(queueId, file, message)
        }
      } catch (error) {
        const message = error.message || 'Upload fehlgeschlagen.'
        errors.push({
          filename: file.name,
          message,
        })
        onFileError?.(queueId, file, message)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, fileList.length) },
    () => worker(),
  )
  await Promise.all(workers)

  if (uploaded.length === 0 && fileList.length > 0) {
    throw new Error(errors[0]?.message || 'Upload fehlgeschlagen.')
  }

  return {
    status: 'ok',
    message: `${uploaded.length} Datei(en) hochgeladen.`,
    folder,
    uploaded,
    errors,
  }
}

export async function fetchFolderMedia(folder, { offset = 0, limit = 5 } = {}) {
  const params = new URLSearchParams({
    folder,
    offset: String(offset),
    limit: String(limit),
  })
  const response = await fetch(`/bp/media/folder?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Inhalte konnten nicht geladen werden.')
  }

  return data
}

export async function fetchWeekMedia(year, month, week) {
  const response = await fetch(
    `/bp/media?year=${year}&month=${month}&week=${week}`,
    {
      credentials: 'include',
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Anfrage fehlgeschlagen.')
  }

  return data
}
