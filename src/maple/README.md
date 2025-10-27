# Maple AI Integration

This module provides end-to-end encrypted inference using [Maple AI](https://trymaple.ai/), which runs on AWS Nitro Enclaves for maximum privacy and security.

## What is Maple AI?

Maple AI provides private AI inference where:
- All data is encrypted end-to-end (client → enclave)
- Code runs in isolated AWS Nitro Enclaves
- Even Maple operators cannot see your data
- GPU computation happens in trusted execution environments (TEEs)
- Code integrity is verifiable through attestation

## Architecture

```
┌─────────────┐    Encrypted     ┌──────────────────┐    Encrypted    ┌─────────────────┐
│   yeet      │  ══════════════▶  │  Nitro Enclave   │  ══════════════▶ │   GPU TEE       │
│  (Client)   │  ◀══════════════  │   (Backend)      │  ◀══════════════ │ (Nvidia/Edgeless)│
└─────────────┘                   └──────────────────┘                  └─────────────────┘
```

## Security Features

1. **Remote Attestation**: Verifies enclave is running trusted code
2. **Certificate Verification**: Validates AWS certificate chain
3. **PCR0 Validation**: Ensures code hasn't been tampered with
4. **End-to-end Encryption**: All requests/responses encrypted with ChaCha20-Poly1305
5. **Ephemeral Keys**: New session keys for each session

## Usage

### 1. Configure Maple

Edit `~/.yeet/config.json`:

```json
{
  "maple": {
    "enabled": true,
    "apiUrl": "https://enclave.trymaple.ai",
    "apiKey": "your-maple-api-key",
    "model": "llama3-3-70b",
    "pcr0Values": [
      "ed9109c16f30a470cf0ea2251816789b4ffa510c990118323ce94a2364b9bf05bdb8777959cbac86f5cabc4852e0da71"
    ]
  }
}
```

### 2. Get Your API Key

Sign up at [https://trymaple.ai](https://trymaple.ai) to get your API key.

### 3. Run yeet

```bash
bun run src/index.ts
```

yeet will automatically use Maple's secure inference when configured!

## How It Works

### 1. Attestation Verification

When yeet starts, it:
1. Generates a random nonce
2. Fetches the attestation document from Maple's enclave
3. Verifies the AWS certificate chain
4. Validates the PCR0 value (code measurement)
5. Verifies the cryptographic signature

This proves you're talking to a legitimate enclave running trusted code.

### 2. Key Exchange

After attestation:
1. yeet generates an ephemeral keypair (Curve25519)
2. Performs X25519 key exchange with the enclave's public key
3. Derives a shared secret
4. Decrypts the session key sent by the enclave

### 3. Encrypted Communication

All API requests:
1. Request bodies are encrypted with ChaCha20-Poly1305
2. Sent with `x-session-id` header for session tracking
3. Responses (JSON and SSE streams) are decrypted automatically

The encryption is completely transparent to the Vercel AI SDK!

## Updating PCR0 Values

When Maple deploys new enclave code, you'll need to update PCR0 values:

### Option 1: From Maple's API

```bash
curl https://enclave.trymaple.ai/attestation | jq -r '.pcr0'
```

### Option 2: From Maple's Status Page

Check the Maple dashboard for the current PCR0 value.

### Update Config

Add the new PCR0 to your config (keep old ones for rollback):

```json
{
  "maple": {
    "pcr0Values": [
      "new-pcr0-value-here",
      "old-pcr0-value-here"
    ]
  }
}
```

## Files

- **crypto.ts** - Main entry point, session establishment
- **attestation.ts** - Attestation verification and PCR0 validation
- **encryption.ts** - ChaCha20-Poly1305 encryption/decryption
- **types.ts** - TypeScript type definitions
- **index.ts** - Public API exports

## Dependencies

```json
{
  "@stablelib/chacha20poly1305": "^2.0.0",  // Symmetric encryption
  "@stablelib/random": "^2.0.0",            // Secure random bytes
  "@stablelib/base64": "^2.0.0",            // Base64 encoding
  "tweetnacl": "^1.0.3",                    // X25519 key exchange
  "@peculiar/x509": "^1.12.2",              // Certificate verification
  "cbor2": "^1.7.0"                         // CBOR parsing (attestation)
}
```

Total bundle size: ~300KB minified

## Troubleshooting

### "PCR0 validation failed"

The enclave code has been updated. Get the new PCR0 value and update your config.

### "Failed to fetch attestation"

Check that:
- `apiUrl` is correct
- You have internet connectivity
- Maple's service is operational

### "Key exchange failed"

Verify that:
- Your API key is valid
- The API key is not expired
- You have sufficient credits

### "Signature verification failed"

This could indicate:
- Network tampering (MITM attack)
- Corrupted attestation document
- Certificate chain issues

Re-running yeet usually resolves transient issues.

## Security Considerations

### What Maple Can't See

- Your messages (encrypted)
- Your files (never sent)
- Model outputs (encrypted)
- Your prompts (encrypted)

### What Maple Can See

- You're using their service (IP address, timing)
- API key usage (billing)
- Model selection
- Token counts (for billing)

### Trust Model

You trust:
- AWS Nitro Enclaves hardware
- Nvidia TEE hardware (for GPU inference)
- Maple's enclave code (verifiable via open source)
- The crypto libraries (@stablelib, tweetnacl)

You don't need to trust:
- Maple operators
- Cloud providers (beyond AWS hardware)
- Network infrastructure

## Performance

- First request: ~500ms overhead (attestation + key exchange)
- Subsequent requests: ~10-20ms overhead (encryption only)
- Streaming: Minimal overhead (per-chunk decryption)

The attestation is cached for the session, so only the first request is slower.

## License

This integration is part of yeet and inherits its license.

Maple AI is a separate service with its own terms of service.
