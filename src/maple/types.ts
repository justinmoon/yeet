/**
 * Type definitions for Maple AI integration
 *
 * Maple uses AWS Nitro Enclaves for secure inference with end-to-end encryption.
 * This module provides types for attestation and encryption operations.
 */

export interface MapleConfig {
  /**
   * Maple API endpoint URL
   * Production: https://enclave.trymaple.ai
   * Development: http://localhost:3000
   */
  apiUrl: string;

  /**
   * Maple API key for authentication
   */
  apiKey: string;

  /**
   * Expected PCR0 values (enclave code measurements)
   * These verify that the enclave is running trusted code.
   * Multiple values support gradual rollout/rollback.
   *
   * TODO: Implement remote signed attestation like OpenSecret-SDK
   * See: ~/code/OpenSecret-SDK/src/lib/pcr.ts for reference implementation
   */
  pcr0Values: string[];
}

export interface AttestationDocument {
  module_id: string;
  digest: "SHA384";
  timestamp: number;
  pcrs: Map<number, Uint8Array>;
  certificate: Uint8Array;
  cabundle: Uint8Array[];
  public_key: Uint8Array | null;
  user_data: Uint8Array | null;
  nonce: Uint8Array | null;
}

export interface ParsedAttestationDocument {
  protected: Uint8Array;
  payload: Uint8Array;
  signature: Uint8Array;
}

export interface Attestation {
  sessionKey: Uint8Array;
  sessionId: string;
  document: AttestationDocument;
}

export interface KeyExchangeResponse {
  encrypted_session_key: string;
  session_id: string;
}
