export const PAGE_TITLES = {
  login: 'Anmelden',
  register: 'Registrieren',
  'reset-password': 'Passwort zurücksetzen',
  'recovery-code': 'Wiederherstellungscode',
  start: 'Mit dir geteilt',
  home: 'Upload',
  content: 'Inhalte',
  community: 'Community',
}

const PATH_BY_PAGE = {
  login: '/login',
  register: '/register',
  'reset-password': '/reset-password',
  'recovery-code': '/recovery',
  start: '/',
  home: '/upload',
  content: '/inhalte',
  community: '/community',
}

export const AUTH_PAGES = new Set([
  'login',
  'register',
  'reset-password',
  'recovery-code',
])

export const APP_PAGES = new Set(['start', 'home', 'content', 'community'])

export function pathForPage(page) {
  return PATH_BY_PAGE[page] || '/login'
}

export function parseLocation(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  switch (path) {
    case '/register':
      return { page: 'register' }
    case '/reset-password':
      return { page: 'reset-password' }
    case '/recovery':
      return { page: 'recovery-code' }
    case '/':
      return { page: 'start' }
    case '/upload':
      return { page: 'home' }
    case '/inhalte':
      return { page: 'content' }
    case '/community':
      return { page: 'community' }
    case '/login':
      return { page: 'login' }
    default:
      return { page: 'unknown' }
  }
}
