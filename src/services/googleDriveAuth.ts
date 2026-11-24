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

export type GoogleDriveAuthErrorCode =
  | 'oauth_not_configured'
  | 'gis_load_failed'
  | 'popup_closed'
  | 'popup_failed_to_open'
  | 'access_denied'
  | 'invalid_client'
  | 'network_error'
  | 'token_missing'
  | 'unknown';

export class GoogleDriveAuthError extends Error {
  code: GoogleDriveAuthErrorCode;

  constructor(code: GoogleDriveAuthErrorCode, message: string) {
    super(message);
    this.name = 'GoogleDriveAuthError';
    this.code = code;
  }
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GisErrorCallbackResponse {
  type?: string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    hint?: string;
  }) => void;
}

interface GisOAuth2Namespace {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    hint?: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: GisErrorCallbackResponse) => void;
  }) => GisTokenClient;
  revoke?: (accessToken: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GisOAuth2Namespace;
      };
    };
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = 'tabscore-google-gis-script';
const GIS_LOAD_TIMEOUT_MS = 12_000;
const DRIVE_ABOUT_URL =
  'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink,permissionId)';

// Stores ONLY non-sensitive public profile metadata (email/display name) so the UI
// remembers which account was linked across reloads. OAuth access tokens are NEVER persisted.
const ACCOUNT_HINT_STORAGE_KEY = 'tabscore_drive_account_hint_v1';

// Strict security requirement: OAuth access tokens MUST remain in memory only,
// never persisted in localStorage, sessionStorage, or IndexedDB.
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
let currentAccount: GoogleDriveAccount | null = null;
let gisLoadPromise: Promise<GisOAuth2Namespace> | null = null;
let legacyCleanupDone = false;

const listeners = new Set<DriveAuthChangeListener>();

/**
 * Validates and returns the configured public Google OAuth 2.0 Web Client ID.
 * Note: An OAuth 2.0 Client ID (*.apps.googleusercontent.com) is NOT an API key
 * and has NO client secret; it is restricted by Google to Authorized JavaScript Origins.
 */
export function validateGoogleOAuthClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Explicitly reject Google API keys (AIza...) or placeholder values
  if (/^AIza/i.test(trimmed)) return null;
  if (!/^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(trimmed)) return null;
  return trimmed;
}

export function getConfiguredGoogleOAuthClientId(): string | null {
  const envVal =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)
      : undefined;
  return validateGoogleOAuthClientId(envVal);
}

export function isGoogleDriveAuthConfigured(): boolean {
  return getConfiguredGoogleOAuthClientId() !== null;
}

function sanitizeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('https://')) return null;
  return trimmed;
}

function loadSavedAccountHint(): GoogleDriveAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_HINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleDriveAccount>;
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid.trim()) {
      return null;
    }
    return {
      uid: parsed.uid.trim(),
      email: typeof parsed.email === 'string' && parsed.email.trim() ? parsed.email.trim() : null,
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName.trim()
          ? parsed.displayName.trim()
          : null,
      photoURL: sanitizeHttpsUrl(parsed.photoURL),
    };
  } catch {
    return null;
  }
}

function saveAccountHint(account: GoogleDriveAccount | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!account) {
      window.localStorage.removeItem(ACCOUNT_HINT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      ACCOUNT_HINT_STORAGE_KEY,
      JSON.stringify({
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
        photoURL: sanitizeHttpsUrl(account.photoURL),
      })
    );
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

/**
 * Removes legacy Firebase Auth browser caches (localStorage/sessionStorage keys
 * starting with "firebase:" and IndexedDB "firebaseLocalStorageDb") that may still
 * reference a previously revoked API key, while leaving all TabScore local data untouched.
 */
export function cleanupLegacyFirebaseAuthStorage(): void {
  if (typeof window === 'undefined') return;
  const scrubStorage = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && /^firebase:/i.test(key)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        storage.removeItem(key);
      }
    } catch {
      // Ignore storage restrictions
    }
  };

  scrubStorage(window.localStorage);
  scrubStorage(window.sessionStorage);

  try {
    if (typeof window.indexedDB !== 'undefined' && typeof window.indexedDB.deleteDatabase === 'function') {
      const req = window.indexedDB.deleteDatabase('firebaseLocalStorageDb');
      req.onerror = () => {};
      req.onblocked = () => {};
    }
  } catch {
    // Ignore IndexedDB unavailability
  }
}

function hasLiveToken(): boolean {
  return Boolean(cachedAccessToken && Date.now() < tokenExpiresAt);
}

function notifyListeners(): void {
  const valid = Boolean(currentAccount && hasLiveToken());
  listeners.forEach((cb) => cb(currentAccount, valid));
}

export function initGoogleDriveAuth(
  onChange: DriveAuthChangeListener
): () => void {
  if (!legacyCleanupDone) {
    legacyCleanupDone = true;
    cleanupLegacyFirebaseAuthStorage();
  }
  if (!currentAccount) {
    currentAccount = loadSavedAccountHint();
  }
  listeners.add(onChange);
  onChange(currentAccount, Boolean(currentAccount && hasLiveToken()));
  return () => {
    listeners.delete(onChange);
  };
}

export function getInMemoryAccessToken(): string | null {
  if (!currentAccount || !hasLiveToken()) {
    return null;
  }
  return cachedAccessToken;
}

export function invalidateInMemoryAccessToken(): void {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  notifyListeners();
}

function loadGoogleIdentityServices(): Promise<GisOAuth2Namespace> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new GoogleDriveAuthError(
        'gis_load_failed',
        'Ambiente browser non disponibile per l’autenticazione Google.'
      )
    );
  }

  const existingOauth2 = window.google?.accounts?.oauth2;
  if (existingOauth2?.initTokenClient) {
    return Promise.resolve(existingOauth2);
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.reject(
      new GoogleDriveAuthError(
        'network_error',
        'Connessione Internet assente: impossibile contattare Google per l’accesso.'
      )
    );
  }

  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise<GisOAuth2Namespace>((resolve, reject) => {
    const fail = (message: string) => {
      gisLoadPromise = null;
      reject(new GoogleDriveAuthError('gis_load_failed', message));
    };

    const timer = window.setTimeout(() => {
      fail(
        'Tempo scaduto durante il caricamento dei servizi di accesso Google. Verifica la connessione o eventuali blocchi del browser.'
      );
    }, GIS_LOAD_TIMEOUT_MS);

    const finishSuccess = () => {
      window.clearTimeout(timer);
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2?.initTokenClient) {
        fail('Servizio di accesso Google non inizializzato correttamente.');
        return;
      }
      resolve(oauth2);
    };

    const existingScript = document.getElementById(
      GIS_SCRIPT_ID
    ) as HTMLScriptElement | null;
    if (existingScript) {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
        finishSuccess();
        return;
      }
      existingScript.addEventListener('load', finishSuccess, { once: true });
      existingScript.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer);
          existingScript.remove();
          fail(
            'Impossibile caricare il modulo di accesso Google. Verifica la connessione o eventuali estensioni di blocco.'
          );
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = finishSuccess;
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      fail(
        'Impossibile caricare il modulo di accesso Google. Verifica la connessione o eventuali estensioni di blocco.'
      );
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

async function fetchGoogleDriveAccountProfile(
  accessToken: string
): Promise<GoogleDriveAccount> {
  const response = await fetch(DRIVE_ABOUT_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Fallback cleanly if profile fields are unavailable; Drive access token is still valid.
    return (
      currentAccount ?? {
        uid: 'google-drive-user',
        email: null,
        displayName: 'Account Google collegato',
        photoURL: null,
      }
    );
  }

  const data = (await response.json()) as {
    user?: {
      displayName?: string;
      emailAddress?: string;
      photoLink?: string;
      permissionId?: string;
    };
  };

  const user = data.user;
  const email =
    typeof user?.emailAddress === 'string' && user.emailAddress.trim()
      ? user.emailAddress.trim()
      : null;
  const displayName =
    typeof user?.displayName === 'string' && user.displayName.trim()
      ? user.displayName.trim()
      : email;
  const uid =
    (typeof user?.permissionId === 'string' && user.permissionId.trim()) ||
    email ||
    'google-drive-user';

  return {
    uid,
    email,
    displayName,
    photoURL: sanitizeHttpsUrl(user?.photoLink),
  };
}

export function mapGoogleAuthError(err: unknown): string {
  if (err instanceof GoogleDriveAuthError) {
    return err.message;
  }

  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'popup_closed':
      return 'Accesso annullato prima del completamento.';
    case 'popup_failed_to_open':
      return 'Il browser ha bloccato la finestra di accesso Google. Consenti i popup per questo sito e riprova.';
    case 'access_denied':
      return 'Accesso a Google Drive non autorizzato. Concedi il permesso richiesto per sincronizzare i dati.';
    case 'invalid_client':
      return 'OAuth Client ID Google non valido o origine del sito non autorizzata in Google Cloud Console.';
    case 'network_error':
      return 'Connessione di rete assente o instabile durante l’accesso Google.';
    default: {
      if (err instanceof Error && err.message) {
        // Defensive guard: never echo raw tokens or key-like strings into UI messages
        if (/AIza[0-9A-Za-z_-]{10,}|ya29\.[0-9A-Za-z_-]{10,}/.test(err.message)) {
          return 'Errore durante l’autenticazione con Google Drive.';
        }
        return err.message;
      }
      return 'Errore durante l’autenticazione con Google Drive.';
    }
  }
}

export async function signInWithGoogleDrive(
  forceAccountSelection = false
): Promise<{ account: GoogleDriveAccount; accessToken: string }> {
  const clientId = getConfiguredGoogleOAuthClientId();
  if (!clientId) {
    throw new GoogleDriveAuthError(
      'oauth_not_configured',
      'Sincronizzazione Google Drive non ancora configurata: imposta la variabile pubblica VITE_GOOGLE_OAUTH_CLIENT_ID (OAuth 2.0 Client ID, senza alcuna API key) e autorizza il dominio in Google Cloud Console.'
    );
  }

  const oauth2 = await loadGoogleIdentityServices();

  const tokenResult = await new Promise<{
    accessToken: string;
    expiresInSec: number;
  }>((resolve, reject) => {
    let settled = false;

    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPES.join(' '),
      ...(currentAccount?.email && !forceAccountSelection
        ? { hint: currentAccount.email }
        : {}),
      callback: (response) => {
        if (settled) return;
        settled = true;

        if (response.error) {
          if (response.error === 'access_denied') {
            reject(
              new GoogleDriveAuthError(
                'access_denied',
                'Accesso a Google Drive negato. Riprova concedendo l’autorizzazione richiesta.'
              )
            );
            return;
          }
          if (response.error === 'invalid_client' || response.error === 'origin_mismatch') {
            const origin =
              typeof window !== 'undefined' ? window.location.origin : 'questo dominio';
            reject(
              new GoogleDriveAuthError(
                'invalid_client',
                `Origine "${origin}" non autorizzata o OAuth Client ID non valido in Google Cloud Console.`
              )
            );
            return;
          }
          reject(
            new GoogleDriveAuthError(
              'unknown',
              'Impossibile completare l’autenticazione con Google Drive.'
            )
          );
          return;
        }

        if (!response.access_token) {
          reject(
            new GoogleDriveAuthError(
              'token_missing',
              'Permesso Google Drive non ricevuto. Riprova concedendo l’accesso richiesto.'
            )
          );
          return;
        }

        const rawExpires = Number(response.expires_in);
        const expiresInSec =
          Number.isFinite(rawExpires) && rawExpires > 180 ? rawExpires : 3600;

        resolve({
          accessToken: response.access_token,
          expiresInSec,
        });
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;

        if (err.type === 'popup_closed') {
          reject(
            new GoogleDriveAuthError(
              'popup_closed',
              'Accesso annullato prima del completamento.'
            )
          );
          return;
        }
        if (err.type === 'popup_failed_to_open') {
          reject(
            new GoogleDriveAuthError(
              'popup_failed_to_open',
              'Il browser ha bloccato la finestra di accesso Google. Consenti i popup per questo sito e riprova.'
            )
          );
          return;
        }
        reject(
          new GoogleDriveAuthError(
            'unknown',
            'Errore durante l’apertura della finestra di accesso Google.'
          )
        );
      },
    });

    tokenClient.requestAccessToken({
      prompt:
        forceAccountSelection || !currentAccount ? 'select_account' : '',
      ...(currentAccount?.email && !forceAccountSelection
        ? { hint: currentAccount.email }
        : {}),
    });
  });

  // Refresh proactively 2 minutes before expiry (typically ~58 min) or on 401
  cachedAccessToken = tokenResult.accessToken;
  tokenExpiresAt =
    Date.now() + Math.max(60, tokenResult.expiresInSec - 120) * 1000;

  const account = await fetchGoogleDriveAccountProfile(tokenResult.accessToken);
  currentAccount = account;
  saveAccountHint(account);
  notifyListeners();

  return {
    account,
    accessToken: tokenResult.accessToken,
  };
}

export async function signOutGoogleDrive(): Promise<void> {
  const tokenToRevoke = cachedAccessToken;
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  currentAccount = null;
  saveAccountHint(null);
  cleanupLegacyFirebaseAuthStorage();

  if (tokenToRevoke && typeof window !== 'undefined') {
    const revoke = window.google?.accounts?.oauth2?.revoke;
    if (typeof revoke === 'function') {
      try {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 1500);
          revoke(tokenToRevoke, () => {
            window.clearTimeout(timer);
            resolve();
          });
        });
      } catch {
        // Ignore network revocation failures on sign-out
      }
    }
  }

  notifyListeners();
}
