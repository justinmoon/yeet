# Maple AI Pricing

## Model Costs

**All text models:** $4 per million tokens (input + output)  
**Image analysis model:** $10 per million tokens

## Available Models (sorted by size)

From smallest (cheapest to run) to largest:

1. **mistral-small-3-1-24b** (24B) - **Best for testing/dev** ✅
   - Conversations, visual insights
   - Fastest, cheapest to run
   - $4 per million tokens

2. **llama-3.3-70b** (70B)
   - Therapy notes, daily tasks, general reasoning
   - $4 per million tokens

3. **qwen2-5-72b** (72B)
   - Multilingual tasks, coding
   - $4 per million tokens

4. **gpt-oss-120b** (120B)
   - ChatGPT creativity & structured data
   - $4 per million tokens

5. **deepseek-r1-0528**
   - Research, advanced math, coding
   - $4 per million tokens

6. **qwen3-coder-480b** (480B)
   - Specialized coding assistant
   - $4 per million tokens

7. **leon-se/gemma-3-27b-it-fp8-dynamic**
   - Image analysis
   - **$10 per million tokens** (more expensive!)

## Subscription Plans

- **Free:** $0/month - 25 messages/week
- **Pro:** $20/month - Power users
- **Max:** $100/month - 20x Pro usage
- **Team:** $30/user/month - 2x Pro per member, pooled credits

## API Credits

- Start at $10 minimum purchase
- Billed at $4 per million tokens for most models

## Recommendations

### For Testing/Development
Use **mistral-small-3-1-24b**:
- Smallest model (24B parameters)
- Fastest responses
- Same price as larger models
- Good enough for E2E tests

### For Production
Consider your use case:
- **General tasks:** llama-3.3-70b or mistral-small-3-1-24b
- **Coding:** qwen2-5-72b or qwen3-coder-480b
- **Reasoning/Math:** deepseek-r1-0528
- **Creativity:** gpt-oss-120b

### Cost Estimation

Typical E2E test run (12 tests):
- ~10-15 API calls
- ~500-1000 tokens total
- **Cost:** ~$0.004 (less than half a cent!)

With $10 credit purchase:
- ~2,500 test runs
- Or ~250M tokens of actual usage
