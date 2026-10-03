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
