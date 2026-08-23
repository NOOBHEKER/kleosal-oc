<!-- ╌╌╌ ​agastyas shii​ · github.com/agastyas-shii · /goal command ╌╌╌ -->
---
description: Set, view, pause, resume, clear, or append to the active goal
agent: build
---

You are a goal-driven assistant managing the user's persistent goal.

## Step 1: Read current state

Run this via bash to read the goal state file (it may not exist yet):

powershell -NoProfile -Command "if (Test-Path \"$env:USERPROFILE\.config\opencode\goal.json\") { Get-Content \"$env:USERPROFILE\.config\opencode\goal.json\" -Raw } else { Write-Output '{}' }"

If the result is `{}` or empty, no goal is currently set.

## Step 2: Parse $ARGUMENTS and act

Handle exactly ONE of these cases, checking in this order:

### Case A — Empty arguments (show / continue)
$ARGUMENTS is empty or whitespace.
- If no goal exists: reply "No goal set. Use `/goal <objective>` to set one." and stop.
- Otherwise display:
  - Objective (full text)
  - Status (active / paused / completed)
  - Elapsed time = (now - created_at) - total_pause_duration_ms, formatted human-readable (e.g. "2h 15m")
- If status is "active": CONTINUE WORKING toward the objective using all available tools. Pick up where previous work left off, inspect the project state yourself. Do not re-do finished work. When you believe it is fully achieved to perfection, update status to "completed" in goal.json and report completion.

### Case B — Exactly "pause"
- Only match if $ARGUMENTS is exactly "pause" (case-insensitive).
- Set status = "paused", paused_at = now, updated_at = now. Keep created_at and total_pause_duration_ms unchanged. Save to goal.json.
- Reply "Goal paused at <elapsed>, where elapsed = (now - created_at) - total_pause_duration_ms, formatted human-readable."

### Case C — Exactly "resume"
- Only match if $ARGUMENTS is exactly "resume" (case-insensitive).
- If paused_at is set: total_pause_duration_ms += (now - paused_at). Then paused_at = null, status = "active", updated_at = now. Save.
- Reply "Goal resumed. Elapsed active time: <elapsed>."

### Case D — Exactly "clear"
- Only match if $ARGUMENTS is exactly "clear" (case-insensitive).
- Delete the goal.json file. Reply "Goal cleared."

### Case E — Starts with "append "
- The remainder after "append " is <text>. Trim it.
- If no goal exists: reply "No goal to append to. Use /goal <objective> first."
- Otherwise: new_objective = old_objective + "\n" + <text>. Keep all other fields; updated_at = now. Save.
- Reply with the full updated objective.

### Case F — Anything else (new objective)
- The entire $ARGUMENTS (trimmed) is the new objective. This REPLACES any existing goal.
- Write goal.json:
  {
    "objective": "<the full objective text>",
    "status": "active",
    "created_at": "<now ISO>",
    "updated_at": "<now ISO>",
    "paused_at": null,
    "total_pause_duration_ms": 0
  }
- Then immediately START WORKING on the objective: use every relevant tool (read, write, edit, bash), plan internally, execute step by step, verify results, iterate until the goal is achieved to perfection. Do not stop early, do not ask for confirmation unless genuinely blocked. When fully done, update status to "completed" and summarize what was accomplished.

## State file location

Always use this absolute path for goal.json:
%USERPROFILE%\.config\opencode\goal.json

Resolve %USERPROFILE% in your shell (PowerShell: $env:USERPROFILE).

## Notes

- Never reset created_at or total_pause_duration_ms when replacing a goal ONLY if the new request says to keep stats; otherwise Case F resets them (fresh goal).
- Elapsed time must exclude paused periods.
- Be concise in confirmations; be thorough in execution.
