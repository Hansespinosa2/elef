# Elef Autonomous Refactor v9

## Authority and execution

- `CONSTITUTION.md` owns campaign-wide product intent, target architecture, staged invariant applicability and completion protocol.
- `phases/00-*.md` through `phases/12-*.md` own phase criteria.
- `status.json` records the current execution state; `status.template.json` supports recovery initialization.
- Root `AGENTS.md` routes to the five installed workflow skills under `.agents/skills/`.

## Start or resume

Tell the agent `go`. It recovers from repository evidence, freezes the current plan, implements, checks a committed candidate, obtains a fresh independent review, records ACT and checkpoints PASS before advancing automatically.

Only final technical PASS or a defined blocker ends the campaign. Human signing/device/deployment/soak gates remain explicit, and the owner merges the final draft PR into `dev`.

## Environment

The default execution machine is an approximately 8 GB Linux container. Record actual resources and toolchains; serialize heavyweight work. Warm feedback, cold bootstrap and product-performance budgets remain distinct. Real native evidence uses the required runner or verified CI for the exact candidate.

## Agent-system installation evidence

See `execution/bootstrap-report.md` and its independent review/acceptance evidence. The installed skill files are the sole workflow source. Setup prompts, copied templates, fallback skills and installers have been removed after installation.
