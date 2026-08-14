const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.bmp',
  '.tif',
  '.tiff',
])

const VIDEO_EXTENSIONS = new Set([
  '.mov',
  '.mp4',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm',
  '.3gp',
  '.mpg',
  '.mpeg',
])

function getExtension(filename = '') {
  const match = /\.[^.]+$/.exec(String(filename).toLowerCase())
  return match ? match[0] : ''
}

export function isAllowedMediaFile(file) {
  if (!file) {
    return false
  }

  const type = file.type || ''
  if (type.startsWith('image/') || type.startsWith('video/')) {
    return true
  }

  const extension = getExtension(file.name)
  if (IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension)) {
    return true
  }

  // iOS Fotos-Picker: manchmal weder MIME noch Dateiendung
  return !type && file.size > 0
}
