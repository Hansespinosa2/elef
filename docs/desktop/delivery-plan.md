# Desktop feature flags

This small register records the deferred desktop features. The architecture checker reads these rows and verifies that both desktop defaults stay off; it is not a release roadmap.

| Flag | Desktop | Web | Removal condition |
|---|---|---|---|
| `ELEF_ENABLE_REVISIONS` | off | on | Ship the shared revisions flow on desktop or remove the feature from the web app |
| `ELEF_ENABLE_LINEAGE` | off | on | Ship the shared lineage flow on desktop or remove the feature from the web app |

The defaults are defined in [feature_flags.js](../../apps/web/app/javascript/lib/feature_flags.js). The CI contract is in [check_architecture.py](../../apps/desktop/scripts/check_architecture.py). Update this table, the shared frontend flags, and scenario coverage together when the product decision changes.
