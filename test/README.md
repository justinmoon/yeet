# Yeet Tests

## E2E Tests

### FizzBuzz Test (`fizzbuzz-e2e.test.ts`)

Tests the full agent workflow by having it write and execute a FizzBuzz program.

**NO MOCKS** - Uses real inference with actual models.

#### Requirements

1. **OpenCode Zen API Key**
   - Automatically loaded from `~/.local/share/opencode/auth.json` if you have OpenCode installed
   - Or add to `~/.yeet/config.json`:
     ```json
     {
       "activeProvider": "opencode",
       "opencode": {
         "apiKey": "your-key-here",
         "baseURL": "https://opencode.ai/zen/v1",
         "model": "grok-code"
       }
     }
     ```

2. **Maple AI API Key** (optional, for Maple test)
   - Add to `~/.yeet/config.json`:
     ```json
     {
       "activeProvider": "maple",
       "maple": {
         "apiUrl": "https://enclave.trymaple.ai",
         "apiKey": "your-maple-key",
         "model": "mistral-small-3-1-24b",
         "pcr0Values": [...]
       }
     }
     ```

#### Running Tests

```bash
# Run both tests (OpenCode + Maple if configured)
bun test test/fizzbuzz-e2e.test.ts

# Run only OpenCode test
bun test test/fizzbuzz-e2e.test.ts -t "OpenCode"

# Run only Maple test
bun test test/fizzbuzz-e2e.test.ts -t "Maple"
```

#### What the Test Does

1. Asks agent to write a FizzBuzz program to `/tmp/yeet-fizzbuzz-test-*/fizzbuzz.js`
2. Asks agent to run it with `node fizzbuzz.js`
3. Verifies:
   - Write tool was called with correct path
   - Bash tool was called to run the program
   - Output matches expected FizzBuzz output (1-15)
   - File actually exists on disk

#### Expected Output

```
============================================================
Starting: FizzBuzz with OpenCode Zen
Provider: opencode
Model: grok-code
============================================================

📤 User message: Write a fizzbuzz program to /tmp/... that prints...

🤖 Agent starting...

[Assistant generates code and uses tools]

🔧 [write] { "path": "/tmp/.../fizzbuzz.js", "content": "..." }
✅ Result: Created /tmp/.../fizzbuzz.js

🔧 [bash] { "command": "node /tmp/.../fizzbuzz.js" }
✅ stdout:
1
2
Fizz
4
Buzz
Fizz
...

📊 Stats:
  Text chunks: 42
  Tool calls: 2
  Tools used: write, bash

🔍 Verifying results...
✓ Write tool called 1 time(s)
✓ Wrote to correct path
✓ Bash tool called 1 time(s)  
✓ Ran the fizzbuzz program
✓ FizzBuzz output is correct!
✓ File exists on disk

✅ FizzBuzz with OpenCode Zen PASSED
```

#### Troubleshooting

**Test times out:**
- Increase timeout in test file (currently 2 minutes)
- Check API credentials are valid
- Check network connection

**"No Maple configuration found":**
- Maple test will skip if no `maple` config exists
- This is expected - test only runs if you have Maple configured

**Output doesn't match:**
- Agent might have written a different FizzBuzz variation
- Check the actual output in test logs
- May need to adjust expectations based on model behavior

**Maple test fails - model refuses to use tools:**
- This is a known issue with Mistral Small models
- The model says "I don't have the capability to execute code"
- Even though tools are properly sent to the API
- Mistral models may need additional prompt engineering or configuration
- OpenCode Zen models work fine with the same tool definitions
- Test is currently skipped for Maple
