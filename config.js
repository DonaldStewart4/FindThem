// config.js — settings that depend on where the app is hosted.
//
// FIREBASE_DB_URL: the address of the Firebase Realtime Database that holds shared searches.
// It is NOT a secret (every visitor's browser uses it), so it's fine to commit. What keeps
// data safe are the database rules in firebase-rules.json. See README.md → "Set up live sharing".
//
// Leave it empty and the app still works: searches just stay on one phone, and share links
// carry the case in the link itself (the same map, but no live updates).

export const FIREBASE_DB_URL = '';
// Example: 'https://findthem-12345-default-rtdb.firebaseio.com'

// PROXY_URL: the address of the deployed LLM proxy (proxy/README.md), used by the report
// box. Also not a secret: the Jev (TypeSafe) key lives only inside the proxy.
export const PROXY_URL = '';
// Example: 'https://findthem-proxy.yourname.workers.dev'

// For testing on your own computer only:
//   ?db=http://localhost:9000      uses tools/mock-firebase.py instead of the real database
//   ?proxy=http://localhost:9100   uses tools/mock-proxy.py instead of the real proxy
function localOverride(name) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const value = new URLSearchParams(location.search).get(name);
  return local && value ? value.replace(/\/$/, '') : null;
}

export function databaseUrl() {
  return localOverride('db') ?? FIREBASE_DB_URL.replace(/\/$/, '');
}

export function proxyUrl() {
  return localOverride('proxy') ?? PROXY_URL.replace(/\/$/, '');
}
