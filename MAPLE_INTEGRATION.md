# Maple AI Integration - Implementation Summary

## Overview

This branch adds support for **Maple AI** - a private inference service that runs on AWS Nitro Enclaves with end-to-end encryption. All data is encrypted client-side and only decrypted inside the secure enclave.

## Changes

### New Files

#### `src/maple/` Directory (~1200 LOC)

- **crypto.ts** (~240 LOC) - Main integration, session establishment, custom fetch wrapper
- **attestation.ts** (~270 LOC) - AWS Nitro Enclave attestation verification
- **encryption.ts** (~50 LOC) - ChaCha20-Poly1305 encryption/decryption
- **types.ts** (~60 LOC) - TypeScript type definitions
- **index.ts** (~10 LOC) - Public API exports
- **README.md** (~200 lines) - Documentation

### Modified Files

- **src/config.ts** - Added `maple` config option
- **src/agent.ts** - Added provider selection logic (Maple vs OpenCode)
- **config.example.json** - Added example Maple configuration
- **package.json** - Added crypto dependencies

### Dependencies Added

```json
{
  "@stablelib/chacha20poly1305": "^2.0.1",
  "@stablelib/random": "^2.0.1",
  "@stablelib/base64": "^2.0.1",
  "tweetnacl": "^1.0.3",
  "@peculiar/x509": "^1.14.0",
  "cbor2": "^2.0.1"
}
```

**Bundle size impact**: ~300KB minified

## How It Works

### Architecture

```
yeet → Vercel AI SDK → Maple Custom Fetch → Encrypted API → Nitro Enclave
```

The integration leverages Vercel AI SDK's `fetch` option to transparently encrypt/decrypt all requests/responses.

### Encryption Flow

1. **Attestation** (on startup)
   - Generate random nonce
   - Fetch attestation document from Maple
   - Verify AWS certificate chain
   - Validate PCR0 (code measurement)
   - Verify cryptographic signature

2. **Key Exchange**
   - Generate ephemeral keypair (Curve25519)
   - Perform X25519 key exchange with enclave
   - Derive shared secret
   - Decrypt session key

3. **Encrypted Communication**
   - Encrypt request bodies with ChaCha20-Poly1305
   - Add `x-session-id` header
   - Decrypt responses (JSON and SSE streams)

### Code Integration Point

```typescript
// src/agent.ts
if (config.maple?.enabled) {
  const mapleFetch = await createMapleFetch({
    apiUrl: config.maple.apiUrl,
    apiKey: config.maple.apiKey,
    pcr0Values: config.maple.pcr0Values,
  });

  provider = createOpenAICompatible({
    name: "maple",
    baseURL: `${config.maple.apiUrl}/v1`,
    fetch: mapleFetch,  // 🔑 Custom encrypted fetch
  });
}
```

## Usage

### Configuration

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

### Running

```bash
bun run src/index.ts
```

When Maple is enabled, you'll see:
```
🔐 Establishing secure session with Maple...
✓ Attestation document parsed
✓ Nonce verified
✓ Certificate chain verified
✓ Public key extracted
✓ Signature verified
✓ PCR0 validation passed
✅ Secure session established
🍁 Using Maple AI (encrypted)
```

## Security

### What's Protected

- All messages (encrypted end-to-end)
- All model outputs (encrypted)
- Session keys (ephemeral, never persisted)
- File contents (never sent to Maple)

### Trust Model

**You trust:**
- AWS Nitro Enclaves hardware
- Maple's open-source enclave code
- Crypto libraries (@stablelib, tweetnacl)

**You don't need to trust:**
- Maple operators (can't see your data)
- Cloud providers (beyond AWS hardware)
- Network infrastructure (MITM protected)

### Attestation

The attestation verifies:
1. Code integrity (PCR0 hash)
2. Enclave authenticity (AWS certificates)
3. No tampering (cryptographic signature)

## Performance

- **First request**: ~500ms overhead (attestation + key exchange)
- **Subsequent requests**: ~10-20ms overhead (encryption only)
- **Streaming**: Minimal overhead (per-chunk decryption)

Session is cached for the lifetime of the process.

## Testing

```bash
# Type check
bun run typecheck

# Run tests (existing tests still pass)
bun test

# Try it with Maple
# 1. Get API key from https://trymaple.ai
# 2. Add maple config to ~/.yeet/config.json
# 3. Run: bun run src/index.ts
```

## Updating PCR0 Values

When Maple updates their enclave:

```bash
# Get new PCR0
curl https://enclave.trymaple.ai/attestation | jq -r '.pcr0'

# Add to config (keep old ones for rollback)
{
  "maple": {
    "pcr0Values": [
      "new-value",
      "old-value"
    ]
  }
}
```

## Design Decisions

### Why Extract, Not Use SDK?

- **Size**: Full @opensecret/react SDK is ~4400 LOC + React deps
- **Control**: We only need crypto, not React context/hooks
- **Bundle**: Extracted version is ~1200 LOC, 300KB minified
- **Simplicity**: Clearer what's happening, easier to debug

### Why TypeScript, Not FFI?

- **Simplicity**: No cross-language debugging
- **Portability**: No platform-specific binaries
- **Performance**: @stablelib is fast enough
- **Maintenance**: Single language codebase

### Why Vercel AI SDK's Custom Fetch?

- **Surgical**: One-line integration
- **Transparent**: No changes to agent logic
- **Clean**: Separation of concerns
- **Flexible**: Easy to swap providers

## Future Work

- [ ] Add unit tests for crypto module
- [ ] Add integration tests with mock enclave
- [ ] Support session refresh (currently one-shot)
- [ ] Add metrics/logging for attestation
- [ ] Support multiple PCR0 values better (auto-update)
- [ ] Add PCR0 update notifications

## References

- [Maple AI](https://trymaple.ai/)
- [OpenSecret Platform](https://opensecret.cloud/)
- [AWS Nitro Enclaves](https://aws.amazon.com/ec2/nitro/nitro-enclaves/)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- [@stablelib](https://github.com/StableLib/stablelib)
- [TweetNaCl](https://tweetnacl.js.org/)

## License

Same as yeet (check main README).
