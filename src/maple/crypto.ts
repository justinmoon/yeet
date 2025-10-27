/**
 * Maple AI Encryption Module
 * 
 * This module provides end-to-end encryption for Maple AI's secure inference.
 * It handles attestation verification, key exchange, and transparent encryption/decryption
 * of all API requests and responses (including Server-Sent Events streams).
 * 
 * Usage:
 *   const fetch = await createMapleFetch(config);
 *   const provider = createOpenAI({ baseURL: mapleUrl, fetch });
 */

import nacl from "tweetnacl";
import { ChaCha20Poly1305 } from "@stablelib/chacha20poly1305";
import { encode, decode } from "@stablelib/base64";
import { verifyAttestation } from "./attestation";
import { encryptMessage, decryptMessage } from "./encryption";
import type { MapleConfig, Attestation, KeyExchangeResponse } from "./types";

/**
 * Fetches the attestation document from Maple
 */
async function fetchAttestationDocument(
  apiUrl: string,
  nonce: string
): Promise<string> {
  // Note: Maple uses path parameter, not query parameter
  const response = await fetch(`${apiUrl}/attestation/${nonce}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch attestation: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { attestation_document: string };
  return data.attestation_document;
}

/**
 * Performs key exchange with the enclave
 */
async function performKeyExchange(
  apiUrl: string,
  clientPublicKey: string,
  nonce: string
): Promise<KeyExchangeResponse> {
  // Note: No Authorization header needed for key exchange
  const response = await fetch(`${apiUrl}/key_exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_public_key: clientPublicKey,
      nonce,
    }),
  });

  if (!response.ok) {
    throw new Error(`Key exchange failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as KeyExchangeResponse;
}

/**
 * Establishes a secure session with Maple's enclave
 * 
 * This performs the full attestation and key exchange flow:
 * 1. Generate a random nonce
 * 2. Fetch and verify the attestation document
 * 3. Extract the enclave's public key
 * 4. Perform X25519 key exchange
 * 5. Decrypt the session key
 */
async function establishSession(config: MapleConfig): Promise<Attestation> {
  console.log("🔐 Establishing secure session with Maple...");

  // 1. Generate nonce for replay attack protection
  const nonce = crypto.randomUUID();
  console.log(`Generated nonce: ${nonce}`);

  // 2. Fetch attestation document
  const attestationBase64 = await fetchAttestationDocument(config.apiUrl, nonce);
  console.log("Fetched attestation document");

  // 3. Verify attestation
  const document = await verifyAttestation(attestationBase64, nonce, config);

  if (!document.public_key) {
    throw new Error("Attestation document missing public key");
  }

  // 4. Generate client keypair for key exchange
  const clientKeyPair = nacl.box.keyPair();
  console.log("Generated client keypair");

  // 5. Perform key exchange with enclave
  const { encrypted_session_key, session_id } = await performKeyExchange(
    config.apiUrl,
    encode(clientKeyPair.publicKey),
    nonce
  );
  console.log("Key exchange completed");

  // 6. Derive shared secret using X25519
  const serverPublicKey = new Uint8Array(document.public_key);
  const sharedSecret = nacl.scalarMult(clientKeyPair.secretKey, serverPublicKey);

  // 7. Decrypt the session key
  const encryptedData = decode(encrypted_session_key);
  const nonceLength = 12;
  const decryptionNonce = encryptedData.slice(0, nonceLength);
  const ciphertext = encryptedData.slice(nonceLength);

  const chacha = new ChaCha20Poly1305(sharedSecret);
  const sessionKey = chacha.open(decryptionNonce, ciphertext);

  if (!sessionKey) {
    throw new Error("Failed to decrypt session key");
  }

  console.log("✅ Secure session established");

  return {
    sessionKey,
    sessionId: session_id,
    document,
  };
}

/**
 * Extracts an SSE event from a buffer
 */
function extractEvent(buffer: string): string | null {
  const eventEnd = buffer.indexOf("\n\n");
  if (eventEnd === -1) return null;
  return buffer.slice(0, eventEnd + 2);
}

/**
 * Decrypts an SSE response stream
 */
function decryptSSEStream(
  response: Response,
  sessionKey: Uint8Array
): Response {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          buffer += chunk;

          let event;
          while ((event = extractEvent(buffer))) {
            buffer = buffer.slice(event.length);

            const lines = event.split("\n");
            for (const line of lines) {
              // Pass through event: lines
              if (line.trim().startsWith("event: ")) {
                controller.enqueue(encoder.encode(line + "\n"));
              }
              // Decrypt data: lines
              else if (line.trim().startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                } else {
                  try {
                    const decrypted = decryptMessage(sessionKey, data);
                    controller.enqueue(encoder.encode(`data: ${decrypted}\n`));
                  } catch (error) {
                    console.error("Failed to decrypt SSE chunk:", error);
                    // Skip corrupted chunks
                  }
                }
              }
              // Pass through empty lines
              else if (line === "") {
                controller.enqueue(encoder.encode("\n"));
              }
            }
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Decrypts a JSON response
 */
async function decryptJSONResponse(
  response: Response,
  sessionKey: Uint8Array
): Promise<Response> {
  const responseText = await response.text();

  try {
    const responseData = JSON.parse(responseText);

    // Check if the response has an encrypted field
    if (responseData.encrypted) {
      const decrypted = decryptMessage(sessionKey, responseData.encrypted);
      
      return new Response(decrypted, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (error) {
    // Not JSON or not encrypted, return as-is
  }

  // Return original response
  return new Response(responseText, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Creates a custom fetch function that encrypts/decrypts all requests/responses
 * 
 * This is the main entry point for using Maple encryption with Vercel AI SDK.
 * 
 * @param config - Maple configuration
 * @returns A fetch function compatible with Vercel AI SDK's `fetch` option
 * 
 * @example
 * ```typescript
 * const mapleFetch = await createMapleFetch({
 *   apiUrl: "https://enclave.trymaple.ai",
 *   apiKey: "your-api-key",
 *   pcr0Values: ["abc123..."],
 * });
 * 
 * const provider = createOpenAI({
 *   baseURL: "https://enclave.trymaple.ai/v1",
 *   fetch: mapleFetch,
 * });
 * ```
 */
export async function createMapleFetch(
  config: MapleConfig
): Promise<(input: string | URL | Request, init?: RequestInit) => Promise<Response>> {
  // Establish secure session once
  const attestation = await establishSession(config);
  const { sessionKey, sessionId } = attestation;

  // Return custom fetch wrapper
  return async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      
      // Prepare headers
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${config.apiKey}`);
      headers.set("x-session-id", sessionId);

      // Encrypt request body if present
      let body = init?.body;
      if (body && typeof body === "string") {
        const encrypted = encryptMessage(sessionKey, body);
        body = JSON.stringify({ encrypted });
        headers.set("Content-Type", "application/json");
      }

      // Make request
      const response = await fetch(url, {
        ...init,
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} ${errorText}`);
      }

      // Decrypt response based on content type
      const contentType = response.headers.get("content-type");
      
      if (contentType?.includes("text/event-stream")) {
        // SSE stream
        return decryptSSEStream(response, sessionKey);
      } else {
        // JSON response
        return decryptJSONResponse(response, sessionKey);
      }
    } catch (error) {
      console.error("Maple fetch error:", error);
      throw error;
    }
  };
}
