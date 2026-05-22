/**
 * Utility for Zero-Knowledge End-to-End Encryption (E2EE)
 * Uses AES-GCM 256-bit encryption natively supported by all modern browsers.
 */

// 1. Generate or retrieve a unique local encryption key for the user
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  if (typeof window === 'undefined') throw new Error('Crypto must run on the client');

  const storedKey = localStorage.getItem('contacts_vault_key');
  
  if (storedKey) {
    // Reconstruct the key from local storage
    const rawKey = Uint8Array.from(atob(storedKey), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // No key found, generate a completely unique, un-guessable new one
  const newKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // Export and save it to the local browser storage ONLY
  const exported = await window.crypto.subtle.exportKey('raw', newKey);
  const base64Key = btoa(String.fromCharCode(...new Uint8Array(exported)));
  localStorage.setItem('contacts_vault_key', base64Key);

  return newKey;
}

// 2. Encrypt plain text into an unreadable scrambled string
export async function encryptData(plainText: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(plainText);

  // Initialization Vector (IV) acts like a unique random salt for this specific encryption run
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encodedData
  );

  // Pack the IV and the encrypted text together into a single string to store in Supabase
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv);
  combined.set(encryptedBytes, iv.length);

  return btoa(String.fromCharCode(...combined));
}

// 3. Decrypt a scrambled string back into readable plain text
export async function decryptData(cipherText: string, key: CryptoKey): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(cipherText), c => c.charCodeAt(0));
    
    // Extract the original 12-byte IV from the front of the string
    const iv = combined.slice(0, 12);
    const encryptedBytes = combined.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encryptedBytes
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    console.error('Decryption failed. The key might be missing or corrupt.', err);
    return '[Encrypted/Corrupt Data]';
  }
}

// Default export to satisfy the TypeScript compiler check in page.tsx
export default getOrCreateEncryptionKey;