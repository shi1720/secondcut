import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import config from './firebase-config.json';
export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);
export const database = getFirestore(firebaseApp);
if (import.meta.env?.VITE_FIREBASE_EMULATORS === '1' || (typeof process !== 'undefined' && process.env.SECONDCUT_USE_EMULATORS === '1')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(database, '127.0.0.1', 8088);
}
