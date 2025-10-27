/**
 * Encryption utilities for Maple AI
 * 
 * Uses ChaCha20-Poly1305 for symmetric encryption with session keys.
 * All messages are encrypted with a random nonce prepended to the ciphertext.
 */

import { ChaCha20Poly1305 } from "@stablelib/chacha20poly1305";
import { randomBytes } from "@stablelib/random";
import { encode, decode } from "@stablelib/base64";

/**
 * Encrypts a message using ChaCha20-Poly1305
 * 
 * @param sessionKey - The session key (32 bytes)
 * @param message - The plaintext message to encrypt
 * @returns Base64-encoded string with nonce prepended
 */
export function encryptMessage(sessionKey: Uint8Array, message: string): string {
  const chacha = new ChaCha20Poly1305(sessionKey);
  const nonce = randomBytes(12);
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const encrypted = chacha.seal(nonce, data);

  // Prepend the nonce to the encrypted data
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);

  return encode(result);
}

/**
 * Decrypts a message using ChaCha20-Poly1305
 * 
 * @param sessionKey - The session key (32 bytes)
 * @param encryptedData - Base64-encoded ciphertext with nonce prepended
 * @returns Decrypted plaintext message
 * @throws Error if decryption fails
 */
export function decryptMessage(sessionKey: Uint8Array, encryptedData: string): string {
  const chacha = new ChaCha20Poly1305(sessionKey);
  const encryptedBytes = decode(encryptedData);

  // Extract nonce (first 12 bytes) and ciphertext
  const nonceLength = 12;
  const nonce = encryptedBytes.slice(0, nonceLength);
  const ciphertext = encryptedBytes.slice(nonceLength);

  const decrypted = chacha.open(nonce, ciphertext);
  if (!decrypted) {
    throw new Error("Decryption failed - message authentication failed");
  }
  
  return new TextDecoder().decode(decrypted);
}
