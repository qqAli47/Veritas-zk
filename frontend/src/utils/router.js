// Lightweight hash-based router utility
// Routes: #/ → home, #/prove → prove, #/restricted → restricted

export function getRoute(hash) {
  if (hash === '#/prove') return 'prove';
  if (hash === '#/restricted') return 'restricted';
  return 'home';
}

export function navigate(path, state) {
  window.__routeState = state || null;
  window.location.hash = path;
}
