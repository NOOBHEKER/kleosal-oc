# MODEL SETUP — Free Vision Model

The default model in this config is `opencode/mimo-v2.5-free`, a free model with vision capabilities. It's provided by opencode's Zen service.

## Step 1: Sign in to opencode Zen

1. Open opencode and run:
   ```
   /connect
   ```
2. Select **opencode (Zen)** from the list.
3. A browser window opens at `https://opencode.ai/auth`.
4. Sign in (free, no credit card required).
5. Close the browser and return to opencode.

## Step 2: Verify the model is set

Check your `opencode.jsonc`:
```jsonc
{
  "model": "opencode/mimo-v2.5-free"
}
```

If you want to use a different free model, replace the value with one of:
- `opencode/qwen3.6-plus-free`
- `opencode/kimi-k2.5-free`
- `opencode/deepseek-v3.2-free`

## Step 3: Test

Run a prompt that requires an image (paste a screenshot with `Ctrl+V` in conhost):
```
What's in this screenshot?
```
The model should respond with vision-based analysis.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Model not found" | Run `/connect` and sign in again |
| "Unauthorized" | Check Zen sign-in status with `/connect` |
| No vision response | Ensure the model name ends with `-free` and you're signed in |

## Notes

- The free models are rate-limited. For heavier use, consider a paid plan.
- You can switch models per-session with the `/model` command.
- All models in this config are remote (no local GPU required).
