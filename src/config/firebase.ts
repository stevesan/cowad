import { createLocalDb } from './localDb';

const CONFIG_KEY = 'cowad-firebase-config';
const CONNECTED_KEY = 'cowad-firebase-connected';

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function hasFirebaseConfig(): boolean {
  return localStorage.getItem(CONFIG_KEY) !== null;
}

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveFirebaseConfig(config: FirebaseConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** True if currently using the real Firebase backend */
export let isConnected: boolean = false;

let db: FirebaseDatabase;

/** Resolves when the database is ready (IndexedDB loaded, or Firebase connected) */
export let ready: Promise<void>;

const wantConnect = localStorage.getItem(CONNECTED_KEY) === 'true';
const config = getFirebaseConfig();

if (wantConnect && config) {
  firebase.initializeApp({ ...config });
  db = firebase.database();
  isConnected = true;
  ready = Promise.resolve();
} else {
  const local = createLocalDb();
  db = local.db;
  ready = local.ready;
}

export { db };
export function mapRef(col: string): FirebaseRef { return db.ref('map/' + col); }

/** Connect to Firebase and reload the page */
export function connectFirebase(): void {
  localStorage.setItem(CONNECTED_KEY, 'true');
  location.reload();
}

/** Disconnect from Firebase and reload the page */
export function disconnectFirebase(): void {
  localStorage.setItem(CONNECTED_KEY, 'false');
  location.reload();
}
