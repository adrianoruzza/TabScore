import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

export interface GoogleDriveAccount {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type DriveAuthChangeListener = (
  account: GoogleDriveAccount | null,
  hasValidToken: boolean
) => void;

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

function createDriveProvider(forceAccountSelection = false): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of DRIVE_SCOPES) {
    provider.addScope(scope);
  }
  if (forceAccountSelection) {
    provider.setCustomParameters({ prompt: 'select_account' });
  }
  return provider;
}

// Strict security requirement: OAuth access tokens MUST remain in memory only,
// never persisted in localStorage or sessionStorage.
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
let isSigningIn = false;

const listeners = new Set<DriveAuthChangeListener>();

function toAccount(user: User): GoogleDriveAccount {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

function hasLiveToken(): boolean {
  return Boolean(cachedAccessToken && Date.now() < tokenExpiresAt);
}

function notifyListeners(user: User | null): void {
  const account = user ? toAccount(user) : null;
  const valid = Boolean(account && hasLiveToken());
  listeners.forEach((cb) => cb(account, valid));
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
  } else if (!hasLiveToken() && !isSigningIn) {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
  }
  notifyListeners(user);
});

export function initGoogleDriveAuth(
  onChange: DriveAuthChangeListener
): () => void {
  listeners.add(onChange);
  const current = auth.currentUser;
  onChange(current ? toAccount(current) : null, Boolean(current && hasLiveToken()));
  return () => {
    listeners.delete(onChange);
  };
}

export function getInMemoryAccessToken(): string | null {
  if (!auth.currentUser || !hasLiveToken()) {
    return null;
  }
  return cachedAccessToken;
}

export function invalidateInMemoryAccessToken(): void {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  notifyListeners(auth.currentUser);
}

export function mapGoogleAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Accesso annullato prima del completamento.';
    case 'auth/popup-blocked':
      return 'Il browser ha bloccato la finestra di accesso Google. Consenti i popup per questo sito e riprova.';
    case 'auth/unauthorized-domain': {
      const host =
        typeof window !== 'undefined' ? window.location.hostname : 'questo dominio';
      return `Dominio "${host}" non ancora autorizzato nelle impostazioni di autenticazione del progetto Google/Firebase.`;
    }
    case 'auth/network-request-failed':
      return 'Connessione di rete assente o instabile durante l’accesso Google.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Errore durante l’autenticazione con Google Drive.';
  }
}

export async function signInWithGoogleDrive(
  forceAccountSelection = false
): Promise<{ account: GoogleDriveAccount; accessToken: string }> {
  isSigningIn = true;
  try {
    const provider = createDriveProvider(forceAccountSelection);
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Permesso Google Drive non ricevuto. Riprova concedendo l’accesso richiesto.'
      );
    }
    cachedAccessToken = credential.accessToken;
    // OAuth tokens usually expire in 3600s; refresh proactively after 50m or on 401
    tokenExpiresAt = Date.now() + 50 * 60 * 1000;
    notifyListeners(result.user);
    return {
      account: toAccount(result.user),
      accessToken: cachedAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  await signOut(auth);
  notifyListeners(null);
}
