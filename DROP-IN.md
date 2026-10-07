# Installation / drop-in

1. Place this bundle at the repository root temporarily.
2. Copy/merge `docs/refactor/` into the repository's `docs/refactor/`.
3. Give the coding agent the full contents of `bootstrap/AUTONOMOUS-AGENT-BOOTSTRAP-PROMPT.md`.
4. The agent must reconcile/install root `AGENTS.md` and `.agents/skills/*`, validate the fresh-agent `go` path, make a bootstrap checkpoint commit, and then continue the campaign.
5. After bootstrap, the temporary `bootstrap/` folder can be removed once its installed equivalents are verified. It is not architectural SSOT.

Do not manually copy skill text into multiple locations. The installed `.agents/skills/*` become workflow sources; Elef architecture/phase truth remains in the constitution and phase contracts.
