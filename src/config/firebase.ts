import { createLocalDb } from './localDb';

const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const STORAGE_KEY = 'cowad-firebase-connected';

const hasAllVars = requiredVars.every(k => import.meta.env[k]);

/** True if Firebase env vars are present (connect button should be shown) */
export const firebaseAvailable: boolean = hasAllVars;

/** True if currently using the real Firebase backend */
export let isConnected: boolean = false;

let db: FirebaseDatabase;

if (hasAllVars && localStorage.getItem(STORAGE_KEY) === 'true') {
  // User previously chose to connect and env vars are present
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  isConnected = true;
} else {
  // Local-only mode
  db = createLocalDb();
}

export { db };
export function mapRef(col: string): FirebaseRef { return db.ref('map/' + col); }

/** Connect to Firebase and reload the page */
export function connectFirebase(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
  location.reload();
}

/** Disconnect from Firebase and reload the page */
export function disconnectFirebase(): void {
  localStorage.setItem(STORAGE_KEY, 'false');
  location.reload();
}
