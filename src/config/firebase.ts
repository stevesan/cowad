const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const missing = requiredVars.filter(k => !import.meta.env[k]);
if (missing.length) {
  document.body.innerHTML = `
    <div style="max-width:600px;margin:80px auto;font-family:monospace;color:#f88;background:#1a1a1a;padding:32px;border-radius:8px;border:1px solid #f44">
      <h2 style="margin-top:0">Firebase config missing</h2>
      <p>Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Firebase project values:</p>
      <pre style="background:#111;padding:12px;border-radius:4px;overflow-x:auto">${missing.map(k => k + '=').join('\n')}</pre>
      <p style="color:#aaa">See <code>.env.example</code> for details. You can find these values in the Firebase console under Project Settings.</p>
    </div>`;
  throw new Error('Missing Firebase env vars: ' + missing.join(', '));
}

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

export const db = firebase.database();
export function mapRef(col: string): FirebaseRef { return db.ref('map/' + col); }
