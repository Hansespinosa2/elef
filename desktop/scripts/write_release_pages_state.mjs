import { readFile } from "node:fs/promises"

import { parseLedger } from "../release/ledger.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"

const [ledgerPath, outputRoot] = process.argv.slice(2)
if (!ledgerPath || !outputRoot) {
  throw new Error("usage: node desktop/scripts/write_release_pages_state.mjs <state.json> <pages-checkout>")
}

const ledger = parseLedger(await readFile(ledgerPath, "utf8"))
const paths = await writePagesStateFiles(outputRoot, ledger)
process.stdout.write(`Derived release state and updater feed: ${paths.join(", ")}\n`)
