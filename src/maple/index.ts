/**
 * Maple AI Integration
 *
 * Provides end-to-end encrypted inference using AWS Nitro Enclaves.
 *
 * @module maple
 */

export { createMapleFetch } from "./crypto";
export type { MapleConfig, Attestation, AttestationDocument } from "./types";
