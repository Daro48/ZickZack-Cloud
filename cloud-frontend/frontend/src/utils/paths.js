export const PAGE_TITLES = {
  login: 'Anmelden',
  register: 'Registrieren',
  'reset-password': 'Passwort zurücksetzen',
  'recovery-code': 'Wiederherstellungscode',
  home: 'Upload',
  content: 'Inhalte',
  community: 'Community',
  'public-share': 'Freigabe',
}

const PATH_BY_PAGE = {
  login: '/login',
  register: '/register',
  'reset-password': '/reset-password',
  'recovery-code': '/recovery',
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

export const APP_PAGES = new Set(['home', 'content', 'community'])

export function pathForPage(page, token) {
  if (page === 'public-share') {
    return token ? `/s/${token}` : '/'
  }
  return PATH_BY_PAGE[page] || '/login'
}

export function parseLocation(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (path.startsWith('/s/')) {
    return { page: 'public-share', token: path.slice(3).split('/')[0] || '' }
  }
  switch (path) {
    case '/register':
      return { page: 'register' }
    case '/reset-password':
      return { page: 'reset-password' }
    case '/recovery':
      return { page: 'recovery-code' }
    case '/':
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
