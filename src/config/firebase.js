const firebaseConfig = {
  apiKey: "AIzaSyBTlTozCk6sPYJZmnWFGb_8ovB8IS_CEEc",
  authDomain: "rdb-test-2513b.firebaseapp.com",
  databaseURL: "https://rdb-test-2513b-default-rtdb.firebaseio.com",
  projectId: "rdb-test-2513b",
  storageBucket: "rdb-test-2513b.firebasestorage.app",
  messagingSenderId: "395624694880",
  appId: "1:395624694880:web:6c7750f08776cfd71daf05"
};

// Firebase SDK loaded via CDN sets window.firebase
firebase.initializeApp(firebaseConfig);

export const db = firebase.database();
export function mapRef(col) { return db.ref('map/' + col); }
