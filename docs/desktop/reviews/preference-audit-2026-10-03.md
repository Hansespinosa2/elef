# Independent preference audit — 2026-10-03

The user requested an independent audit followed by verification and fixes. The read-only auditor (Bacon) reviewed implementation commit `339d692`, the architecture documents, existing CI logs, and in-memory probes. Its later harness check covered `5110c77`. This report records validated findings and correction evidence; it is not a declaration of v1 acceptance.

| Finding | Verified cause | Correction and regression evidence |
|---|---|---|
| First manifest creation/duplicate UUID repair blocks saving | Adapter indexed the baseline by requested identity while the frontend activated the returned UUID | `a5f1ae3`: index by returned identity; unit tests save through both identity transitions. The shell reconciles stale library IDs. |
| Native Quit bypasses unsaved protection | Native menu called `app.exit(0)` directly | `6c24909`: Quit and OS user-exit requests use the window-close/save guard. Tests wait for outstanding saves, coalesce repeated requests, and retain the window on conflicts/failures. Dirty native Quit still needs real-binary regression evidence. |
| Undo/recovery can copy deck A into deck B | Deck loads were history transactions; discarded buffers lacked identity | `4072c2d`/`6631b73`: recovery drafts carry deck identity; each deck load creates a fresh CodeMirror state/history boundary. Tests exercise switching/reopening and actual CodeMirror undo transactions. |
| Undo while a save runs permits navigation too early | Matching the previous baseline cleared dirty state before the outstanding write completed | `4072c2d`: outstanding writes remain dirty; flush waits and persists the final buffer. The deferred-write test asserts the old→new→undo interleaving stores the chosen old buffer before permitting navigation. |
| Deck loads change CRLF/CR into LF | An empty persistent editor selected LF once and normalized later loads | `6631b73`: each new document state selects its separator from that source. CodeMirror state tests compare source bytes through edits for LF, CRLF, and CR. Actual native file lifecycle coverage remains required. |
| Update backup removed before UI health | Cleanup ran during native setup | Readiness acknowledgement follows library initialization, actual editor readiness, and first paint. Native shell checks the main local webview and cleans once; failed bootstrap never acknowledges cleanup in unit tests. The installed relaunch scenario checks actual backup removal. |

The auditor judged canonical folders, archive implementation, portable preferences, normalized collision keys, and disabled revision/lineage flags satisfactory within inspected coverage. It found editor/save compliance incomplete because of the defects above. Shared card/controller code and selected scenarios do not establish full UI equivalence.

## Remaining verification

- Latest native matrix, including the macOS installed updater cycle, must pass. `5110c77` passed all eight web scenarios and 22 of 23 macOS native cases: Appearance and native chooser/export cancellation passed; the package installation case failed. The test now preserves the primary error if resetting the fixture also fails.
- The final production paths and additional native lifecycle scenarios must validate the corrections, followed by the auditor's spot-check.
- Exact JS-derived renderer fixtures prove runtime agreement, not legacy equivalence. Normalized comparison, remaining consumer parity, production soak, and Ruby rollback deletion remain open.
- Fixture-channel signing is independent of the owner production signing ceremony. Gatekeeper, target-device release performance, keyboard/native interaction feel, and a week of real work remain human/device gates.

See [test-strategy.md](../test-strategy.md), [S1 evidence](../spike-results/S1-rails-inventory.md), and [delivery-plan.md](../delivery-plan.md) for their verification contracts.

## Auditor follow-up

The source follow-up confirmed the six original fixes but found three lifecycle details requiring correction: readiness accepted a controller published before connection finished; fresh state did not reapply current Vim/editing-mode/frontmatter settings; recovery-button visibility used the global draft count. The editor now advertises readiness only after initialization, its wait rejects partially connected controllers, deck loads reapply current preferences, and recovery visibility uses active-deck availability. Unit readiness and document-state tests and static wiring assertions cover these contracts; native lifecycle evidence remains separate.

The auditor's second spot-check at `18447cb` confirmed those three corrections without finding another concrete regression in that scope. The macOS job at `289fe4e` passed the manifestless first-save/CRLF and cross-deck history scenario. At `18447cb`, Linux passed all 24 native scenarios plus the installed N relaunch/backup-cleanup scenario, then failed the separate Quit smoke. Its close listener needed the missing `allow-destroy` permission. macOS passed 23 of 24 scenarios; its updater confirmation timed out because the unparented message dialog uses a global system notification. Native confirmations now attach to Elef's main window. Both corrections require new native CI evidence.

At `627dcef`, the macOS desktop job passed: 24 native scenarios, installed version-N relaunch/backup cleanup, and three actual native Quit launches (clean, unsaved draft, external-change conflict). Linux still failed Appearance: its unscoped selector could find a hidden library preview before the editor preview. Assertions now target the active editor projection.

The auditor's third spot-check found two additional P1 navigation races: reading the active deck advanced its save fingerprint before pending edits were flushed, and new-deck save ownership changed before asynchronous graph preparation finished. The transport now separates read from activation. Preparation preserves old-deck ownership, saves intervening edits against the original fingerprint, and rereads the target before one synchronous buffer/identity activation. Three deferred-interleaving regression tests cover both reported races. Native and auditor re-verification remain required.
