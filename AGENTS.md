# Repository Instructions

## Architecture
- Elef is a Rails monolith for authoring and presenting Markdown slide decks.
- Raw Markdown is canonical.
- Prefer Rails views with Hotwire/Stimulus.

## Development Environment
- Run agents natively on the user's Omarchy device in the current checkout.
- Reuse `https://127.0.0.1:3000/`; never start another server or change ports.
- Restart only for boot-time changes.
- Do not use the retired `scripts/elef-agent` Apple Container/worktree workflow.

## GitHub
- Use the available GitHub integration for GitHub work.
- Never print, request, save, or commit credentials. Do not copy credentials into `.env` files.

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
- For requested PR work, branch from the latest `dev` and target the PR at `dev`, unless the user specifies another base.
- Commit coherent changes with concise imperative subjects.
- Never add co-author trailers, rewrite history, or revert unrelated changes.
- When an open PR exists for a task branch, use that PR as the merge boundary. If asked to merge the branch, merge the PR through GitHub rather than creating a substitute local merge commit.
- Only perform a local branch merge when it is explicitly requested and no PR merge is intended.
- PR descriptions must use the repository template, explain validation and database/migration impact, and must not record current merge status.
- After a PR is merged, fetch its target branch and verify the merge commit is reachable from that target. Do not trust stale `origin/*` refs.
