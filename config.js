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

// For testing on your own computer only: open http://localhost:8000/?db=http://localhost:9000
// to use tools/mock-firebase.py instead of the real database.
export function databaseUrl() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const override = new URLSearchParams(location.search).get('db');
  if (local && override) return override.replace(/\/$/, '');
  return FIREBASE_DB_URL.replace(/\/$/, '');
}
