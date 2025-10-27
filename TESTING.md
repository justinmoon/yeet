# Testing Maple Integration

## Quick Start

### 1. Setup Credentials

```bash
# Copy the example config
cp .env.test.example .env.test

# Edit with your API key
nano .env.test  # or your favorite editor
```

Add your Maple API key:
```bash
MAPLE_API_KEY=your-maple-api-key-here
```

### 2. Run E2E Tests

```bash
# Easy way (uses .env.test automatically)
./scripts/test-maple.sh

# Or manually
source .env.test && bun test test/maple-e2e.test.ts

# Or inline
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts
```

## What Gets Tested

### ✅ Attestation & Cryptography
- AWS Nitro Enclave attestation verification
- Certificate chain validation  
- PCR0 code measurement validation
- X25519 key exchange
- ChaCha20-Poly1305 encryption/decryption

### ✅ API Integration
- List models endpoint
- Non-streaming chat completions
- Streaming chat completions (SSE)
- Request encryption
- Response decryption

### ✅ Vercel AI SDK
- `streamText()` integration
- Streaming responses
- Tool calls
- Multi-step agent flows

### ✅ Error Handling
- Invalid API keys
- Invalid PCR0 values
- Network errors
- Malformed responses

### ✅ Performance
- Session establishment < 5s
- Request overhead < 2s average
- Streaming latency

## Test Structure

```
test/
├── maple-e2e.test.ts          # E2E tests (real API)
├── tools/                     # Unit tests (mocked)
│   ├── bash.test.ts
│   ├── read.test.ts
│   ├── edit.test.ts
│   └── write.test.ts
└── README.md                  # This file
```

## Running Specific Tests

```bash
# All Maple tests
./scripts/test-maple.sh

# Specific test suite
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts -t "Attestation"

# Specific test
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts -t "should establish secure session"

# All unit tests (no API key needed)
bun test test/tools/

# Watch mode
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts --watch
```

## Expected Output

```
🍁 Maple AI E2E Test Runner

✓ Loading credentials from .env.test
✓ API Key: sk-12345...
✓ API URL: https://enclave.trymaple.ai

Running E2E tests...

🔐 Testing against: https://enclave.trymaple.ai
🔑 API key: sk-12345...

🔒 Verifying attestation document...
✓ Attestation document parsed
✓ Document payload extracted
✓ Nonce verified
✓ Certificate chain verified
✓ Public key extracted
✓ Signature verified
✓ PCR0 validation passed: ed9109c16f...
✅ Attestation verification complete

Maple AI E2E Tests > Attestation & Key Exchange > should establish secure session
  ✅ Secure session established [487ms]

Maple AI E2E Tests > Attestation & Key Exchange > should verify attestation document
  ✅ Attestation document fetched [142ms]

Maple AI E2E Tests > Raw API Calls > should list available models
  ✅ Found 3 models [234ms]
     Models: llama3-3-70b, gpt-4, claude-3

Maple AI E2E Tests > Raw API Calls > should make encrypted chat completion request
  ✅ Non-streaming response: "test successful" [1.2s]

Maple AI E2E Tests > Raw API Calls > should make encrypted streaming chat completion
  ✅ Streaming response (12 chunks): "1 2 3" [1.5s]

Maple AI E2E Tests > Vercel AI SDK Integration > should work with streamText
  ✅ Vercel AI SDK streaming (8 chunks): "Hello from Maple!" [1.1s]

Maple AI E2E Tests > Vercel AI SDK Integration > should handle tool calls
     🔧 Tool called: calculator("2+2")
  ✅ Tool calls: 1 tool(s) called [2.3s]
     Final response: "The answer is 4"

Maple AI E2E Tests > Error Handling > should handle invalid API key
  ✅ Invalid API key rejected (status: 401) [98ms]

Maple AI E2E Tests > Error Handling > should handle invalid PCR0 values
  ✅ Invalid PCR0 rejected: PCR0 validation failed [543ms]

Maple AI E2E Tests > Performance > should establish session in reasonable time
  ✅ Session established in 487ms [487ms]

Maple AI E2E Tests > Performance > subsequent requests should be fast
  ✅ Avg request time: 342ms (times: 321, 354, 351ms) [1.1s]

✅ All tests passed!

12 tests passed
0 tests failed
Time: 9.2s
```

## Cost Considerations

⚠️ **These tests make real API calls that cost money**

Each test run:
- ~12 API calls
- ~500-1000 tokens total
- ~$0.01-0.05 per run (at current pricing)

### Cost Reduction Tips

```bash
# Run only one test
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts -t "should establish"

# Skip expensive tests
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts --grep-invert "tool calls"

# Use local/staging environment if available
MAPLE_API_URL=http://localhost:3000 MAPLE_API_KEY=test ./scripts/test-maple.sh
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/maple-e2e.yml
name: Maple E2E Tests

on:
  push:
    branches: [main, maple-integration]
  pull_request:
  schedule:
    - cron: '0 0 * * 1'  # Weekly on Monday

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - run: bun install
      
      - name: Run Maple E2E Tests
        if: ${{ secrets.MAPLE_API_KEY != '' }}
        env:
          MAPLE_API_KEY: ${{ secrets.MAPLE_API_KEY }}
        run: bun test test/maple-e2e.test.ts
      
      - name: Skip Tests (No Credentials)
        if: ${{ secrets.MAPLE_API_KEY == '' }}
        run: echo "Skipping Maple E2E tests (no API key)"
```

### GitLab CI

```yaml
# .gitlab-ci.yml
maple-e2e:
  image: oven/bun:latest
  script:
    - bun install
    - bun test test/maple-e2e.test.ts
  only:
    - main
    - maple-integration
  variables:
    MAPLE_API_KEY: $MAPLE_API_KEY
  allow_failure: true  # Don't fail pipeline if no credentials
```

## Troubleshooting

### Tests Skip Immediately

**Problem**: Tests say "Skipping Maple E2E tests"

**Solution**: Make sure `MAPLE_API_KEY` is set
```bash
# Check if set
echo $MAPLE_API_KEY

# Source from file
source .env.test && bun test test/maple-e2e.test.ts
```

### PCR0 Validation Failed

**Problem**: `PCR0 validation failed. Got: abc123..., Expected: def456...`

**Solution**: Maple updated their enclave. Update PCR0 values:

1. Get current PCR0:
```bash
curl https://enclave.trymaple.ai/attestation | jq
```

2. Update in `test/maple-e2e.test.ts`:
```typescript
const PCR0_VALUES = [
  "new-pcr0-here",
  "old-pcr0-for-rollback",
];
```

### 404 Not Found on /attestation

**Problem**: `Failed to fetch attestation: 404 Not Found`

**Solution**: Check the API URL is correct
```bash
# Verify endpoint exists
curl https://enclave.trymaple.ai/attestation

# Try with nonce
curl "https://enclave.trymaple.ai/attestation?nonce=$(uuidgen)"
```

If 404 persists, the endpoint path might have changed. Check Maple's API docs.

### 401 Unauthorized

**Problem**: `Request failed: 401 Unauthorized`

**Solution**: 
- Check API key is correct (no extra spaces/newlines)
- Verify API key is not expired
- Check you have sufficient credits

### Tests Timeout

**Problem**: Tests hang or timeout after 30s

**Solution**:
- Check internet connection
- Maple API might be slow/down
- Increase timeout in test file:
```typescript
test("...", async () => {
  // ...
}, { timeout: 60000 }); // 60 seconds
```

### Rate Limited (429)

**Problem**: `Request failed: 429 Too Many Requests`

**Solution**:
- Wait a few minutes
- Check your API quota
- Reduce test frequency
- Use staging environment if available

## Updating Tests

### Adding New Tests

```typescript
test("should test new feature", async () => {
  if (!mapleFetch) {
    mapleFetch = await createMapleFetch(config);
  }

  // Your test code here
  const result = await mapleFetch(...);
  
  expect(result).toBeDefined();
  console.log("✅ New test passed");
}, { timeout: 10000 });
```

### Adding New PCR0 Values

When Maple deploys new code:

```typescript
const PCR0_VALUES = [
  "latest-pcr0-value",
  "previous-pcr0-value",  // Keep for rollback
  "even-older-pcr0",      // Remove after confirmed stable
];
```

### Testing Against Staging

```bash
# If Maple has a staging environment
MAPLE_API_URL=https://staging.enclave.trymaple.ai \
MAPLE_API_KEY=staging-key \
./scripts/test-maple.sh
```

## Performance Benchmarks

Expected performance on good network:

| Operation | Time | Notes |
|-----------|------|-------|
| Attestation + Key Exchange | 300-800ms | One-time per session |
| Model list | 100-300ms | Cached by Maple |
| Chat (non-streaming) | 1-3s | Depends on tokens |
| Chat (streaming) | 1-5s | First token + completion |
| Subsequent requests | 200-500ms | Encryption overhead only |

If you see significantly higher times:
- Check network latency: `ping enclave.trymaple.ai`
- Check DNS resolution: `nslookup enclave.trymaple.ai`
- Try different network/VPN

## Getting Help

1. **Check test output** for specific error messages
2. **Run with verbose logging**:
   ```bash
   DEBUG=* MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts
   ```
3. **Check Maple status**: https://status.trymaple.ai (if exists)
4. **Contact Maple support**: team@trymaple.ai
5. **Open an issue** with:
   - Test output (redact API key!)
   - Environment (OS, Bun version)
   - Network info (VPN, proxy, etc.)
