# Testing

## Unit Tests

Run all unit tests:
```bash
bun test test/tools/
```

Run specific test file:
```bash
bun test test/tools/bash.test.ts
```

## E2E Tests (Real Maple API)

The `maple-e2e.test.ts` file contains end-to-end tests that run against the **real** Maple API (no mocks).

### Setup

1. Get a Maple API key from [https://trymaple.ai](https://trymaple.ai)

2. Create `.env.test`:
   ```bash
   cp .env.test.example .env.test
   ```

3. Add your API key to `.env.test`:
   ```bash
   MAPLE_API_KEY=your-actual-api-key
   ```

### Running E2E Tests

```bash
# Run all Maple E2E tests
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts

# Or use .env.test file
source .env.test && bun test test/maple-e2e.test.ts

# Run specific test
MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts -t "should establish secure session"

# Skip if no credentials (default behavior)
bun test test/maple-e2e.test.ts  # Will skip all tests
```

### What Gets Tested

#### Attestation & Key Exchange
- ✅ Establishes secure session
- ✅ Verifies attestation document
- ✅ Validates PCR0 values
- ✅ Performs X25519 key exchange

#### Raw API Calls
- ✅ Lists available models
- ✅ Non-streaming chat completion
- ✅ Streaming chat completion (SSE)
- ✅ Encryption/decryption of requests/responses

#### Vercel AI SDK Integration
- ✅ Works with `streamText()`
- ✅ Handles streaming responses
- ✅ Supports tool calls

#### Error Handling
- ✅ Rejects invalid API keys
- ✅ Rejects invalid PCR0 values
- ✅ Handles network errors

#### Performance
- ✅ Session establishes in < 5s
- ✅ Subsequent requests < 2s average

### Test Output Example

```
🔐 Testing against: https://enclave.trymaple.ai
🔑 API key: sk-12345...

✅ Secure session established
✅ Attestation document fetched
✅ Found 3 models
   Models: llama3-3-70b, gpt-4, claude-3
✅ Non-streaming response: "test successful"
✅ Streaming response (12 chunks): "1 2 3"
✅ Vercel AI SDK streaming (8 chunks): "Hello from Maple!"
✅ Tool calls: 1 tool(s) called
   🔧 Tool called: calculator("2+2")
   Final response: "The answer is 4"
✅ Invalid API key rejected (status: 401)
✅ Invalid PCR0 rejected: PCR0 validation failed
✅ Session established in 487ms
✅ Avg request time: 342ms (times: 321, 354, 351ms)
```

### Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run Maple E2E Tests
  if: ${{ secrets.MAPLE_API_KEY != '' }}
  env:
    MAPLE_API_KEY: ${{ secrets.MAPLE_API_KEY }}
  run: bun test test/maple-e2e.test.ts
```

Tests will automatically skip if `MAPLE_API_KEY` is not set, so they won't fail in environments without credentials.

### Updating PCR0 Values

When Maple updates their enclave, update the PCR0 values in `test/maple-e2e.test.ts`:

```typescript
const PCR0_VALUES = [
  "new-pcr0-value-here",
  "old-pcr0-value-for-rollback",
];
```

Get the current PCR0:
```bash
# From Maple's API
curl https://enclave.trymaple.ai/attestation | jq

# Or use the utility test
bun test test/maple-e2e.test.ts -t "fetch current PCR0"
```

### Cost Considerations

⚠️ **These tests make real API calls** that consume credits:
- Each test run uses ~5-10 API calls
- Each call uses ~50-100 tokens
- Total cost: ~$0.01-0.05 per test run

To minimize costs:
- Run only when needed (not on every commit)
- Use `bun test -t "specific test"` for targeted testing
- Consider rate limiting in CI

### Troubleshooting

**Tests skip without running:**
- Make sure `MAPLE_API_KEY` environment variable is set
- Check that the API key is valid and not expired

**"PCR0 validation failed":**
- Maple updated their enclave
- Update `PCR0_VALUES` in the test file with the new value

**"Request failed: 429":**
- Rate limited
- Wait a few minutes and try again
- Check your API quota

**"Session establishment timeout":**
- Network issue or Maple API is slow
- Increase timeout in test config
- Try again later
