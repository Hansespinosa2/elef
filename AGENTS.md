# Repository Instructions

## Architecture
- Elef is a Rails monolith for authoring and presenting Markdown slide decks.
- Raw Markdown is canonical.
- Prefer Rails views with Hotwire/Stimulus.

## Development Environment
- Reuse `https://127.0.0.1:3000/`; never start another server or change ports.
- Restart only for boot-time changes.
- The primary checkout belongs to the user's main agent. Never implicitly
  create branches, worktrees, or containers.

## Isolated Agents
- The user creates tasks with `scripts/elef-agent start TASK` and enters them
  with `scripts/elef-agent codex TASK`.
- Use the task URL `https://TASK.localhost` for browser checks.
- Never interrupt/recreate an active task without confirmation.
- Preserve the worktree and `/home/developer/.codex` state across recreation.

## Testing
- Unit-test parsing/rendering, request-test Rails boundaries, and use headless
  Selenium for complete workflows.
- Run the smallest relevant test first.
- Re-test relevant behavior after the final change.
- Report only what the performed tests directly establish.

## UI Verification
- Browser automation must be headless.
- Distinguish:
  1. DOM assertions
  2. exact reproduction of user state
  3. inspected screenshot
- Never claim a higher verification level than was performed.

## Git
- Commit coherent changes frequently with concise imperative subjects.
- Never add co-author trailers, rewrite history, or revert unrelated changes.