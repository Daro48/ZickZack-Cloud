const UPLOAD_CONCURRENCY = 3
const RESUME_MIN_BYTES = 8 * 1024 * 1024
const CHUNK_SIZE = 8 * 1024 * 1024
const RESUME_STORAGE_KEY = 'cloud-upload-resume-v1'
const activeXhrs = new Set()

export function abortActiveUploads() {
  for (const xhr of [...activeXhrs]) {
    xhr.abort()
  }
}

function readResumeMap() {
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeResumeMap(map) {
  window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(map))
}

function rememberResume(clientKey, uploadId) {
  const map = readResumeMap()
  map[clientKey] = uploadId
  writeResumeMap(map)
}

function forgetResume(clientKey) {
  const map = readResumeMap()
  if (map[clientKey]) {
    delete map[clientKey]
    writeResumeMap(map)
  }
}

async function clientKeyFor(file, folder) {
  const payload = `${folder}|${file.name}|${file.size}|${file.lastModified}`
  if (!window.crypto?.subtle) {
    return `${file.size.toString(16)}${String(file.lastModified).slice(-8)}`.padEnd(
      16,
      '0',
    )
  }
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function parseXhrJson(xhr) {
  if (xhr.response && typeof xhr.response === 'object') {
    return xhr.response
  }
  try {
    return JSON.parse(xhr.responseText || '{}')
  } catch {
    return {}
  }
}

function sendXhr(xhr, body) {
  return new Promise((resolve, reject) => {
    activeXhrs.add(xhr)

    xhr.onload = () => {
      activeXhrs.delete(xhr)
      resolve(parseXhrJson(xhr))
    }
    xhr.onerror = () => {
      activeXhrs.delete(xhr)
      reject(new Error('Netzwerkfehler'))
    }
    xhr.ontimeout = () => {
      activeXhrs.delete(xhr)
      reject(new Error('Timeout'))
    }
    xhr.onabort = () => {
      activeXhrs.delete(xhr)
      const error = new Error('Abgebrochen')
      error.aborted = true
      reject(error)
    }

    xhr.send(body)
  })
}

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

    sendXhr(xhr, formData)
      .then((data) => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(file.size, file.size)
          resolve(data)
          return
        }
        reject(new Error(data.message || `Upload fehlgeschlagen: ${file.name}`))
      })
      .catch(reject)
  })
}

async function initResumableUpload(file, folder, clientKey) {
  const response = await fetch('/bp/media/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder,
      filename: file.name,
      size: file.size,
      mime_type: file.type,
      client_key: clientKey,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || `Upload fehlgeschlagen: ${file.name}`)
  }
  return data
}

function putResumableChunk(uploadId, blob, offset, fileSize, onProgress) {
  const xhr = new XMLHttpRequest()
  xhr.open('PUT', `/bp/media/uploads/${uploadId}?offset=${offset}`)
  xhr.withCredentials = true
  xhr.responseType = 'json'
  xhr.timeout = 60 * 60 * 1000
  xhr.setRequestHeader('Content-Type', 'application/octet-stream')
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) {
      return
    }
    onProgress?.(Math.min(offset + event.loaded, fileSize), fileSize)
  }

  return sendXhr(xhr, blob).then((data) => {
    if (xhr.status >= 200 && xhr.status < 300) {
      return data
    }
    const error = new Error(data.message || `Upload fehlgeschlagen`)
    error.offset = data.offset
    throw error
  })
}

async function completeResumableUpload(uploadId) {
  const response = await fetch(`/bp/media/uploads/${uploadId}/complete`, {
    method: 'POST',
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Upload fehlgeschlagen.')
  }
  return data
}

async function uploadResumableFile(file, { folder, onProgress } = {}) {
  const clientKey = await clientKeyFor(file, folder)
  const storedId = readResumeMap()[clientKey]
  let session = await initResumableUpload(file, folder, clientKey)
  rememberResume(clientKey, session.upload_id)

  if (storedId && storedId !== session.upload_id) {
    rememberResume(clientKey, session.upload_id)
  }

  let offset = Number(session.offset) || 0
  onProgress?.(offset, file.size)

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size)
    const blob = file.slice(offset, end)
    const data = await putResumableChunk(
      session.upload_id,
      blob,
      offset,
      file.size,
      onProgress,
    )
    const nextOffset = Number(data.offset)
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      throw new Error(`Upload fehlgeschlagen: ${file.name}`)
    }
    offset = nextOffset
    onProgress?.(offset, file.size)
  }

  const completed = await completeResumableUpload(session.upload_id)
  forgetResume(clientKey)
  onProgress?.(file.size, file.size)
  return completed
}

function uploadFile(file, options) {
  if (file.size >= RESUME_MIN_BYTES) {
    return uploadResumableFile(file, options)
  }
  return uploadSingleFile(file, options)
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
        const data = await uploadFile(file, {
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

export async function fetchFolderMedia(
  folder,
  { offset = 0, limit = 5, query = '', type = 'all', sort = 'newest' } = {},
) {
  const params = new URLSearchParams({
    folder,
    offset: String(offset),
    limit: String(limit),
    sort,
  })
  if (query) {
    params.set('q', query)
  }
  if (type && type !== 'all') {
    params.set('type', type)
  }
  const response = await fetch(`/bp/media/folder?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || 'Inhalte konnten nicht geladen werden.')
  }

  return data
}

export async function fetchStorage() {
  const response = await fetch('/bp/media/storage', {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Speicher konnte nicht geladen werden.')
  }
  return data
}

export async function renameFolder(folder, newFolder) {
  const response = await fetch('/bp/media/folders', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folder, new_folder: newFolder }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Ordner konnte nicht umbenannt werden.')
  }
  return data
}

export async function deleteFolder(folder) {
  const params = new URLSearchParams({ folder })
  const response = await fetch(`/bp/media/folders?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Ordner konnte nicht gelöscht werden.')
  }
  return data
}

export async function deleteMediaItems(items) {
  const response = await fetch('/bp/media/delete', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: items.map((item) => ({ type: item.type, id: item.id })),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Dateien konnten nicht gelöscht werden.')
  }
  return data
}

export async function moveMediaItems(items, folder) {
  const response = await fetch('/bp/media/move', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      folder,
      items: items.map((item) => ({ type: item.type, id: item.id })),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Dateien konnten nicht verschoben werden.')
  }
  return data
}

export async function fetchTimelineMedia({
  offset = 0,
  limit = 50,
  query = '',
  type = 'all',
} = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  if (query) {
    params.set('q', query)
  }
  if (type && type !== 'all') {
    params.set('type', type)
  }
  const response = await fetch(`/bp/media/timeline?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Zeitleiste konnte nicht geladen werden.')
  }
  return data
}

export async function fetchTrashMedia({
  offset = 0,
  limit = 50,
  query = '',
  type = 'all',
} = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  if (query) {
    params.set('q', query)
  }
  if (type && type !== 'all') {
    params.set('type', type)
  }
  const response = await fetch(`/bp/media/trash?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Papierkorb konnte nicht geladen werden.')
  }
  return data
}

export async function restoreMediaItems(items) {
  const response = await fetch('/bp/media/restore', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: items.map((item) => ({ type: item.type, id: item.id })),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Dateien konnten nicht wiederhergestellt werden.')
  }
  return data
}

export async function purgeMediaItems(items, { empty = false } = {}) {
  const response = await fetch('/bp/media/purge', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      empty
        ? { empty: true }
        : { items: items.map((item) => ({ type: item.type, id: item.id })) },
    ),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Dateien konnten nicht endgültig gelöscht werden.')
  }
  return data
}

export async function renameMediaItem(item, originalName) {
  const response = await fetch(`/bp/media/file/${item.type}/${item.id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ original_name: originalName }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Datei konnte nicht umbenannt werden.')
  }
  return data
}
