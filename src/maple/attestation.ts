/**
 * AWS Nitro Enclave attestation verification
 *
 * This module verifies that we're communicating with a legitimate AWS Nitro Enclave
 * running trusted code. It performs:
 * 1. Certificate chain verification
 * 2. PCR0 (code measurement) validation
 * 3. Cryptographic signature verification
 * 4. Nonce validation (replay attack prevention)
 */

import { X509Certificate, X509ChainBuilder } from "@peculiar/x509";
import { decode, encode } from "@stablelib/base64";
import * as cbor from "cbor2";
import { logger } from "../logger";
import type {
  AttestationDocument,
  MapleConfig,
  ParsedAttestationDocument,
} from "./types";

// AWS Nitro Enclaves root certificate (from AWS docs)
// This is the public root certificate that all Nitro Enclave certificates chain to
const AWS_ROOT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9qNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

/**
 * Parses the CBOR-encoded attestation document
 */
async function parseAttestationDocument(
  attestationBase64: string,
): Promise<ParsedAttestationDocument> {
  try {
    const attestationBuffer = decode(attestationBase64);
    const cborDoc: Uint8Array[] = cbor.decode(attestationBuffer);

    // COSE_Sign1 structure: [protected, unprotected, payload, signature]
    const protectedHeader = cborDoc[0];
    const payload = cborDoc[2];
    const signature = cborDoc[3];

    return {
      protected: protectedHeader,
      payload,
      signature,
    };
  } catch (error) {
    throw new Error(`Failed to parse attestation document: ${error}`);
  }
}

/**
 * Parses the inner attestation document payload
 */
async function parseDocumentPayload(
  payload: Uint8Array,
): Promise<AttestationDocument> {
  try {
    const documentData = cbor.decode(payload) as any;

    // Convert pcrs object to Map if it's not already
    if (documentData.pcrs && !(documentData.pcrs instanceof Map)) {
      documentData.pcrs = new Map(Object.entries(documentData.pcrs));
    }

    return documentData as AttestationDocument;
  } catch (error) {
    throw new Error(`Failed to parse document payload: ${error}`);
  }
}

/**
 * Creates a COSE Signature1 structure for verification
 */
function createSigStructure(
  bodyProtected: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const sig1 = [
    "Signature1",
    bodyProtected,
    new Uint8Array(0), // external_aad
    payload,
  ];
  return cbor.encode(sig1);
}

/**
 * Verifies the attestation document signature
 */
async function verifySignature(
  parsedDoc: ParsedAttestationDocument,
  publicKey: CryptoKey,
): Promise<boolean> {
  try {
    const signatureBytes = createSigStructure(
      parsedDoc.protected,
      parsedDoc.payload,
    );

    const verified = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-384",
      },
      publicKey,
      parsedDoc.signature as BufferSource,
      signatureBytes as BufferSource,
    );

    return verified;
  } catch (error) {
    throw new Error(`Signature verification failed: ${error}`);
  }
}

/**
 * Verifies the X.509 certificate chain
 */
async function verifyCertificateChain(
  certificate: Uint8Array,
  cabundle: Uint8Array[],
): Promise<X509Certificate> {
  try {
    // Parse the leaf certificate
    const leafCert = new X509Certificate(certificate as BufferSource);

    // Parse CA bundle
    const caCerts = cabundle.map(
      (cert) => new X509Certificate(cert as BufferSource),
    );

    // Parse root certificate
    const rootCert = new X509Certificate(AWS_ROOT_CERT_PEM);

    // Build and verify certificate chain
    const chainBuilder = new X509ChainBuilder({
      certificates: [leafCert, ...caCerts, rootCert],
    });

    const chain = await chainBuilder.build(leafCert);

    if (chain.length === 0) {
      throw new Error("Failed to build certificate chain");
    }

    return leafCert;
  } catch (error) {
    throw new Error(`Certificate chain verification failed: ${error}`);
  }
}

/**
 * Validates PCR0 value against expected values
 */
function validatePCR0(
  pcrs: Map<number, Uint8Array>,
  expectedPCR0Values: string[],
): void {
  const pcr0 = pcrs.get(0);
  if (!pcr0) {
    throw new Error("PCR0 not found in attestation document");
  }

  // Convert PCR0 to hex string
  const pcr0Hex = Array.from(pcr0)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Check if it matches any of the expected values
  const isValid = expectedPCR0Values.some(
    (expected) => expected.toLowerCase() === pcr0Hex.toLowerCase(),
  );

  if (!isValid) {
    throw new Error(
      `PCR0 validation failed. Got: ${pcr0Hex}, Expected one of: ${expectedPCR0Values.join(", ")}`,
    );
  }
}

/**
 * Main attestation verification function
 *
 * @param attestationBase64 - Base64-encoded attestation document
 * @param nonce - The nonce that should be in the attestation document
 * @param config - Maple configuration with expected PCR0 values
 * @returns Verified attestation document
 */
export async function verifyAttestation(
  attestationBase64: string,
  nonce: string,
  config: MapleConfig,
): Promise<AttestationDocument> {
  logger.debug("Verifying attestation document");

  // 1. Parse the CBOR document
  const parsedDoc = await parseAttestationDocument(attestationBase64);
  logger.debug("Attestation document parsed");

  // 2. Extract the inner document
  const document = await parseDocumentPayload(parsedDoc.payload);
  logger.debug("Document payload extracted");

  // 3. Verify nonce
  if (!document.nonce) {
    throw new Error("Attestation document missing nonce");
  }
  const nonceStr = new TextDecoder().decode(document.nonce);
  if (nonceStr !== nonce) {
    throw new Error(`Nonce mismatch. Expected: ${nonce}, Got: ${nonceStr}`);
  }
  logger.debug("Nonce verified");

  // 4. Verify certificate chain
  const leafCert = await verifyCertificateChain(
    document.certificate,
    document.cabundle,
  );
  logger.debug("Certificate chain verified");

  // 5. Extract public key from certificate
  const publicKeyData = await crypto.subtle.importKey(
    "spki",
    leafCert.publicKey.rawData,
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["verify"],
  );
  logger.debug("Public key extracted");

  // 6. Verify signature
  const signatureValid = await verifySignature(parsedDoc, publicKeyData);
  if (!signatureValid) {
    throw new Error("Signature verification failed");
  }
  logger.debug("Signature verified");

  // 7. Validate PCR0
  validatePCR0(document.pcrs, config.pcr0Values);
  logger.debug("PCR0 validated");

  logger.info("Attestation verification complete");
  return document;
}
