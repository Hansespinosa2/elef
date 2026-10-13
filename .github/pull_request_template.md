## Summary

<!-- One paragraph: user-visible outcome first. A reviewer should grasp the change in 10 seconds. -->

## Why

<!-- The problem, finding, or decision this PR addresses. Link the driving issue or directive. -->

## What changed

<!-- Concrete file/behavior inventory: which owners changed (shared package vs web host vs desktop host vs CI), and the behavior delta in one line per area. -->

## Screenshots

<!-- REQUIRED for any visual change: EMBED before/after image pairs CROPPED to the
specific changed parts (not only full pages), one pair per part — hosted
images (e.g. a scratch assets branch), never local file paths. Name what to
look at in each pair. No visual change: write "None — <reason>" (e.g. CI-only,
behavior covered by unit tests). Desktop-shell-only changes that cannot render
in a browser: say so and list the on-device checks instead. -->

## Validation

<!-- Exact evidence, not claims. Every line names the command, result, and
platform. Report only checks that actually ran — never write an unrun check
as passing. Include the negative control when you fixed a failure (what failed
before, what passes after). -->

## Adversarial reviews

<!-- Full trace: round number, verdict (FAIL/PASS), and what each round found,
until acceptance. Format: "Round 1: FAIL — <findings>. Round 2: PASS."
No review yet: write the gate explicitly, e.g. "Queued — do not merge before
PASS." Reviews that never happened are a gap, not an omission. -->

## Parity

<!-- How web/desktop/macOS parity is ensured for this change: shared-package
inheritance, per-host evidence, or N/A with reason. Name which hosts ran
green and which remain unverified. -->

## Gaps

<!-- Known unknowns: unverified paths, untested platforms, taste checks
needing human eyes, deferred hardening. Write "None" only when true. -->

## Database / migration impact

<!-- Explicitly say whether schema, migrations, seeds, persistence, or database configuration changed. -->

## Follow-up

<!-- Record deferred work, rollout notes, or write "None". -->
