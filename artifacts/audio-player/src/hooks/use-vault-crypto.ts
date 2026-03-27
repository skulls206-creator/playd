/**
 * Zero-knowledge vault crypto module.
 *
 * Browser-side only — the server never sees plaintext audio bytes.
 *
 * Key derivation:
 *   PBKDF2(password, salt, 100_000 iter, SHA-256) → AES-GCM 256-bit master key
 *
 * Per-file encryption:
 *   1. Generate a random AES-GCM 256-bit per-file key
 *   2. Encrypt the audio bytes with the per-file key (AES-GCM, random 12-byte IV → dataIv)
 *   3. Export the per-file key as raw bytes and encrypt those with the master key
 *      (AES-GCM, random 12-byte IV → keyIv) → encryptedKey
 *
 * The master key is stored in sessionStorage as an exported JWK so it survives
 * soft navigation/page refresh within the same browser tab session.
 */

import { create } from 'zustand';

// ── Utilities ────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ── Session storage ───────────────────────────────────────────────────────────

const SESSION_KEY = 'playd_vault_jwk';

async function storeVaultKeyInSession(key: CryptoKey): Promise<void> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(jwk)); } catch { /* storage blocked */ }
}

async function loadVaultKeyFromSession(): Promise<CryptoKey | null> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const jwk = JSON.parse(raw) as JsonWebKey;
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM', length: 256 },
      true, // extractable — needed for JWK round-trip
      ['encrypt', 'decrypt'],
    );
  } catch {
    return null;
  }
}

export function clearVaultKeyFromSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  useVaultUnlock.getState()._setKey(null);
}

/** Alias: clear vault key from session and Zustand state. */
export const clearVaultKey = clearVaultKeyFromSession;

/**
 * React hook to access the current vault unlock state (isUnlocking + vaultKey).
 * Thin alias over `useVaultUnlock` for ergonomic hook naming.
 */
export function useVaultKey() {
  return useVaultUnlock(state => ({ key: state.vaultKey, isUnlocking: state.isUnlocking }));
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES-GCM master key from a password and a hex-encoded salt
 * using PBKDF2 with 100 000 iterations and SHA-256.
 */
export async function deriveVaultKey(password: string, saltHex: string): Promise<CryptoKey> {
  const saltBytes = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,  // extractable → allows JWK export/import for sessionStorage
    ['encrypt', 'decrypt'],
  );
}

// ── Encryption ────────────────────────────────────────────────────────────────

export interface VaultEncryptResult {
  ciphertext: ArrayBuffer;
  encryptedKey: string; // base64(AES-GCM encrypted per-file key)
  keyIv:        string; // base64(IV used to encrypt the per-file key)
  dataIv:       string; // base64(IV used to encrypt the file data)
}

/**
 * Encrypt a File using AES-GCM with a random per-file key.
 * The per-file key is itself encrypted with the master key.
 * Nothing leaves the browser in plaintext.
 */
export async function encryptFile(
  file: File | ArrayBuffer,
  masterKey: CryptoKey,
): Promise<VaultEncryptResult> {
  const fileKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable — so we can export and encrypt it
    ['encrypt', 'decrypt'],
  );

  // Encrypt the file data
  const dataIvBytes = crypto.getRandomValues(new Uint8Array(12));
  const fileBytes   = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const ciphertext  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dataIvBytes },
    fileKey,
    fileBytes,
  );

  // Encrypt the per-file key with the master key
  const rawFileKey        = await crypto.subtle.exportKey('raw', fileKey);
  const keyIvBytes        = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKeyBytes = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: keyIvBytes },
    masterKey,
    rawFileKey,
  );

  return {
    ciphertext,
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKeyBytes)),
    keyIv:        bytesToBase64(keyIvBytes),
    dataIv:       bytesToBase64(dataIvBytes),
  };
}

// ── Decryption ────────────────────────────────────────────────────────────────

/**
 * Decrypt a vault blob back to the original audio bytes.
 */
export async function decryptVaultBlob(
  ciphertext: ArrayBuffer,
  encryptedKey: string,
  keyIv:        string,
  dataIv:       string,
  masterKey:    CryptoKey,
): Promise<ArrayBuffer> {
  const rawFileKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(keyIv) },
    masterKey,
    base64ToBytes(encryptedKey),
  );

  const fileKey = await crypto.subtle.importKey(
    'raw',
    rawFileKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(dataIv) },
    fileKey,
    ciphertext,
  );
}

// ── Zustand store for vault unlock state ──────────────────────────────────────

interface VaultUnlockState {
  vaultKey:    CryptoKey | null;
  isUnlocking: boolean;
  _resolve:    ((key: CryptoKey) => void) | null;
  _reject:     ((err: Error) => void)     | null;

  _setKey: (key: CryptoKey | null) => void;
  _open:   (resolve: (key: CryptoKey) => void, reject: (err: Error) => void) => void;
  _close:  () => void;
}

export const useVaultUnlock = create<VaultUnlockState>((set) => ({
  vaultKey:    null,
  isUnlocking: false,
  _resolve:    null,
  _reject:     null,

  _setKey: (key) => set({ vaultKey: key }),
  _open:   (resolve, reject) => set({ isUnlocking: true, _resolve: resolve, _reject: reject }),
  _close:  () => set({ isUnlocking: false, _resolve: null, _reject: null }),
}));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the current vault master key.
 * First checks the Zustand store, then attempts to restore from sessionStorage.
 * Returns null if no key is available (user must unlock).
 */
export async function getVaultKey(): Promise<CryptoKey | null> {
  const { vaultKey } = useVaultUnlock.getState();
  if (vaultKey) return vaultKey;

  const sessionKey = await loadVaultKeyFromSession();
  if (sessionKey) {
    useVaultUnlock.getState()._setKey(sessionKey);
    return sessionKey;
  }
  return null;
}

/**
 * Request the vault master key. If it is not in session, opens the unlock modal
 * and returns a Promise that resolves when the user successfully enters their
 * password. Rejects if the user cancels.
 */
export function requestVaultKey(): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    getVaultKey().then(key => {
      if (key) { resolve(key); return; }
      useVaultUnlock.getState()._open(resolve, reject);
    }).catch(reject);
  });
}

/**
 * Called by VaultUnlockModal after a successful key derivation.
 */
export async function fulfillVaultKey(key: CryptoKey): Promise<void> {
  const { _resolve, _close } = useVaultUnlock.getState();
  useVaultUnlock.getState()._setKey(key);
  await storeVaultKeyInSession(key);
  _close();
  _resolve?.(key);
}

/**
 * Called by VaultUnlockModal when the user cancels the unlock dialog.
 */
export function cancelVaultUnlock(reason = 'User cancelled vault unlock'): void {
  const { _reject, _close } = useVaultUnlock.getState();
  _close();
  _reject?.(new Error(reason));
}

/**
 * Alias for `decryptVaultBlob` matching the originally-requested surface.
 * Must be declared after decryptVaultBlob is defined.
 */
export const decryptFile = decryptVaultBlob;
