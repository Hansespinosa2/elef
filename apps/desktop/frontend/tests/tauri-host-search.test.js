import assert from "node:assert/strict"
import test from "node:test"

import { createTauriHost } from "../src/tauri-host.js"

// Ranking parity with the Rails WorkSearch
// (apps/web/app/services/work_search.rb): phrase-aware clauses, diacritic-
// insensitive matching, title 120 / heading 75 / content 40 weights (the
// desktop keeps no alias store, so the 100-weight alias field stays empty),
// all-clauses-must-match, 180-char excerpts, and score ordering.

function folder({ id, name, kind = "document", modified_ms = 1_700_000_000_000 }) {
  return { id, name, kind, modified_ms, warnings: [], notices: [] }
}

function hostWith({ folders, graph = null, snapshots = {} }) {
  const calls = []
  const graphSources =
    graph ?? folders.filter((entry) => entry.kind === "document").map((entry) => ({ id: entry.id }))
  const host = createTauriHost({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "list_work_folders") return folders
      if (command === "document_graph") {
        return graphSources.map((entry) => ({
          id: entry.id,
          name: folders.find((folder) => folder.id === entry.id)?.name ?? "",
          source: entry.source ?? "",
        }))
      }
      if (command === "read_source_snapshot") {
        if (!(payload.id in snapshots)) throw new Error(`no snapshot for ${payload.id}`)
        return { source: snapshots[payload.id], content_hash: "h1" }
      }
      throw new Error(`unexpected command ${command}`)
    },
  })
  return { host, calls }
}

function titles(result) {
  return result.hits.map((hit) => hit.work.title)
}

test("blank queries return no hits instead of the whole library", async () => {
  const folders = [folder({ id: "1", name: "Anything", modified_ms: 1 })]
  const { host } = hostWith({ folders, graph: [{ id: "1", source: "# Anything\n" }] })
  for (const query of ["", "   ", '""']) {
    const result = await host.search.search({ requestId: "req-blank", query })
    assert.equal(result.requestId, "req-blank")
    assert.deepEqual(result.hits, [])
  }
})

test("nonsense query finds nothing and the request id echoes", async () => {
  const folders = [folder({ id: "1", name: "Searchable", modified_ms: 1 })]
  const { host } = hostWith({ folders, graph: [{ id: "1", source: "# Searchable\n" }] })
  const found = await host.search.search({ requestId: "req-1", query: "Searchable" })
  assert.equal(found.requestId, "req-1")
  assert.deepEqual(titles(found), ["Searchable"])
  const empty = await host.search.search({ requestId: "req-2", query: "no-such-work-zzz-9f8e7d6c" })
  assert.equal(empty.requestId, "req-2")
  assert.deepEqual(empty.hits, [])
})

test("ranks title matches above headings above content with excerpts", async () => {
  const folders = [
    folder({ id: "content", name: "General Notes", modified_ms: 3 }),
    folder({ id: "heading", name: "Outline", modified_ms: 2 }),
    folder({ id: "title", name: "RankTerm Guide", modified_ms: 1 }),
  ]
  const { host } = hostWith({
    folders,
    graph: [
      { id: "content", source: "# Section\n\nRankTerm here" },
      { id: "heading", source: "# RankTerm\n\nBody" },
      { id: "title", source: "# Details\n\nBody" },
    ],
  })
  const result = await host.search.search({ requestId: "req-rank", query: "RankTerm" })
  assert.deepEqual(titles(result), ["RankTerm Guide", "Outline", "General Notes"])
  assert.equal(result.hits[0].excerpt, "RankTerm Guide")
  assert.ok(result.hits[1].excerpt.includes("RankTerm"))
  assert.ok(result.hits[2].excerpt.includes("RankTerm"))
})

test("quoted phrases match across line breaks", async () => {
  const folders = [folder({ id: "1", name: "Survey Notes", modified_ms: 1 })]
  const { host } = hostWith({
    folders,
    graph: [{ id: "1", source: "# Survey\n\nA memorable\nphrase from field research." }],
  })
  const result = await host.search.search({ requestId: "req-phrase", query: '"memorable phrase"' })
  assert.deepEqual(titles(result), ["Survey Notes"])
})

test("matches ignore diacritics and case", async () => {
  const folders = [folder({ id: "1", name: "Café au Lait Report", modified_ms: 1 })]
  const { host } = hostWith({
    folders,
    graph: [{ id: "1", source: "# Résumé\n\nNotes from Zürich" }],
  })
  for (const query of ["cafe", "resume", "zurich", "CAFÉ"]) {
    const result = await host.search.search({ requestId: "req-dia", query })
    assert.deepEqual(titles(result), ["Café au Lait Report"], `query ${query} finds the work`)
  }
})

test("requires every clause to match somewhere", async () => {
  const folders = [folder({ id: "1", name: "Alpha Beta", modified_ms: 1 })]
  const { host } = hostWith({
    folders,
    graph: [{ id: "1", source: "# Gamma\n\nDelta" }],
  })
  const found = await host.search.search({ requestId: "req-and", query: "Alpha Delta" })
  assert.deepEqual(titles(found), ["Alpha Beta"])
  const missed = await host.search.search({ requestId: "req-and", query: "Alpha Epsilon" })
  assert.deepEqual(missed.hits, [])
})

test("content excerpts center the match with ellipses", async () => {
  const prefix = "The quick brown fox jumps over the lazy dog. ".repeat(3)
  const suffix = " More trailing details follow at the end of the text.".repeat(3)
  const folders = [folder({ id: "1", name: "Padded", modified_ms: 1 })]
  const { host } = hostWith({
    folders,
    graph: [{ id: "1", source: `# Doc\n\n${prefix}UniqueAnchor${suffix}` }],
  })
  const result = await host.search.search({ requestId: "req-ctx", query: "UniqueAnchor" })
  assert.equal(result.hits.length, 1)
  assert.ok(result.hits[0].excerpt.startsWith("…"))
  assert.ok(result.hits[0].excerpt.endsWith("…"))
  assert.ok(result.hits[0].excerpt.includes("UniqueAnchor"))
})

test("presentation sources match through the snapshot fallback", async () => {
  const folders = [
    folder({ id: "doc-1", name: "Doc", modified_ms: 1 }),
    folder({ id: "pres-1", name: "Slide Deck", kind: "presentation", modified_ms: 2 }),
  ]
  const { host, calls } = hostWith({
    folders,
    graph: [{ id: "doc-1", source: "# Doc\n" }],
    snapshots: { "pres-1": "# Deck\n\nprojector lumens calibration" },
  })
  const result = await host.search.search({ requestId: "req-pres", query: "lumens" })
  assert.deepEqual(titles(result), ["Slide Deck"])
  assert.ok(result.hits[0].excerpt.includes("lumens"))
  const snapshotReads = calls
    .filter(([command]) => command === "read_source_snapshot")
    .map(([, payload]) => payload.id)
  assert.deepEqual(snapshotReads, ["pres-1"])
})

test("newer works win score ties", async () => {
  const folders = [
    folder({ id: "old", name: "Tie A", modified_ms: 1_000 }),
    folder({ id: "new", name: "Tie B", modified_ms: 2_000 }),
  ]
  const { host } = hostWith({
    folders,
    graph: [
      { id: "old", source: "# A\n\nTiebreakAnchor here" },
      { id: "new", source: "# B\n\nTiebreakAnchor here" },
    ],
  })
  const result = await host.search.search({ requestId: "req-tie", query: "TiebreakAnchor" })
  assert.deepEqual(titles(result), ["Tie B", "Tie A"])
})

test("caps results at thirty like the web caller", async () => {
  const folders = Array.from({ length: 35 }, (_, index) =>
    folder({ id: `batch-${index}`, name: `Batch Document ${index}`, modified_ms: index }),
  )
  const { host } = hostWith({
    folders,
    graph: folders.map((entry) => ({ id: entry.id, source: "# Source\n\nCommonKeyword" })),
  })
  const result = await host.search.search({ requestId: "req-limit", query: "CommonKeyword" })
  assert.equal(result.hits.length, 30)
})
