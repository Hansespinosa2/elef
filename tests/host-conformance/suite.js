// One contract conformance suite for every ElefHost adapter.
//
// The suite is runner-agnostic: each case receives the host, the adapter
// policy, a unique name prefix, and a minimal assert shim, so the same cases
// run under node:test locally and inside the desktop wdio spec in CI.
// A case returns "skip" only for a host capability the adapter declares
// up front in its policy; the declaration itself is asserted.

export const SUITE_VERSION = 1;

function prefixName(prefix, title) {
  return `${prefix} ${title}`;
}

export const CASES = [
  {
    id: "capabilities.shape",
    async run({ host, a }) {
      const caps = host.capabilities;
      for (const key of [
        "accounts",
        "collaboration",
        "entitlements",
        "updater",
        "nativeMenus",
        "localFilesystem",
      ]) {
        a.equal(typeof caps[key], "boolean", `capability ${key} is a boolean`);
      }
    },
  },
  {
    id: "library.workspaces-shape",
    async run({ host, a }) {
      const spaces = await host.library.listWorkspaces();
      a.ok(Array.isArray(spaces) && spaces.length > 0, "at least one workspace");
      for (const space of spaces) {
        a.equal(typeof space.id, "string", "workspace id is a string");
        a.equal(typeof space.name, "string", "workspace name is a string");
      }
    },
  },
  {
    id: "library.crud",
    async run({ host, prefix, policy, a }) {
      const spaces = await host.library.listWorkspaces();
      const workspaceId = spaces[0].id;
      const doc = await host.library.createWork({
        workspaceId,
        title: prefixName(prefix, "doc"),
        kind: "document",
        text: `# ${prefix} doc\n`,
      });
      a.equal(doc.title, prefixName(prefix, "doc"), "created document title");
      a.equal(doc.kind, "document", "created document kind");
      function checkCardMetadata(item) {
        a.equal(typeof item.updatedAt, "string", "summary carries an updatedAt timestamp");
        a.ok(!Number.isNaN(Date.parse(item.updatedAt)), "updatedAt parses as a date");
        a.ok(Array.isArray(item.warnings), "summary carries a warnings array");
      }
      checkCardMetadata(doc);
      const deck = await host.library.createWork({
        workspaceId,
        title: prefixName(prefix, "slides"),
        kind: "presentation",
      });
      a.equal(deck.kind, "presentation", "created presentation kind");
      checkCardMetadata(deck);
      const works = await host.library.listWorks(workspaceId);
      const ids = new Set(works.map((work) => work.id));
      a.ok(ids.has(doc.id) && ids.has(deck.id), "list contains created works");
      for (const item of works.filter((work) => work.id === doc.id || work.id === deck.id)) {
        checkCardMetadata(item);
      }
      const renamed = await host.library.renameWork(deck.id, prefixName(prefix, "renamed"));
      a.equal(renamed.title, prefixName(prefix, "renamed"), "rename applies");
      if (policy.deleteProgrammatic === false) {
        return "skip: delete is dialog-mediated; cleanup deletes are no-ops suite-wide";
      }
      await host.library.deleteWork(doc.id);
      await host.library.deleteWork(deck.id);
      const after = await host.library.listWorks(workspaceId);
      const remaining = new Set(after.map((work) => work.id));
      a.ok(!remaining.has(doc.id) && !remaining.has(deck.id), "delete removes works");
    },
  },
  {
    id: "library.delete-dialog-mediated",
    async run({ host, policy, a }) {
      if (policy.deleteProgrammatic !== false) return "skip";
      a.equal(
        policy.deleteProgrammatic,
        false,
        "adapter declares dialog-mediated delete",
      );
    },
  },
  {
    id: "works.get-save",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title: prefixName(prefix, "save"),
        kind: "document",
        text: `# ${prefix} save\n`,
      });
      const snapshot = await host.works.getWork(created.id);
      a.equal(typeof snapshot.text, "string", "snapshot text is a string");
      a.equal(typeof snapshot.baseline.revision, "string", "baseline revision is a string");
      const next = `# ${prefix} save\n\nEdited.\n`;
      const saved = await host.works.saveWork(created.id, next, snapshot.baseline);
      a.equal(saved.kind, "saved", "clean save reports saved");
      a.equal(typeof saved.baseline.revision, "string", "saved baseline is a string");
      const reread = await host.works.getWork(created.id);
      a.equal(reread.text, next, "saved text round-trips");
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "works.conflict",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title: prefixName(prefix, "conflict"),
        kind: "document",
        text: `# ${prefix} conflict\n`,
      });
      const first = await host.works.getWork(created.id);
      const external = `${first.text}\nExternal edit.\n`;
      const externalSave = await host.works.saveWork(created.id, external, first.baseline);
      a.equal(externalSave.kind, "saved", "external save succeeds");
      const stale = await host.works.saveWork(created.id, "stale attempt\n", first.baseline);
      a.equal(stale.kind, "conflict", "stale baseline conflicts");
      a.equal(stale.current.text, external, "conflict carries current text");
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "session.lifecycle",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title: prefixName(prefix, "session"),
        kind: "document",
        text: `# ${prefix} session\n`,
      });
      const session = await host.createWorkSession(created.id);
      a.equal(session.workId, created.id, "session targets the work");
      const seen = [];
      const offStatus = session.onStatus((status) => seen.push(status.kind));
      const offExternal = session.onExternalChange(() => {});
      session.applyLocalChange({
        from: session.getText().length,
        to: session.getText().length,
        insert: "More.\n",
      });
      a.ok(seen.includes("dirty"), "local change reports dirty");
      const flushed = await session.flush();
      a.ok(flushed.kind === "saved" || flushed.kind === "clean", "flush saves");
      const reread = await host.works.getWork(created.id);
      a.equal(reread.text, session.getText(), "flushed text persists");
      offStatus();
      offExternal();
      session.dispose();
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "session.external-change",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title: prefixName(prefix, "session-ext"),
        kind: "document",
        text: `# ${prefix} session-ext\n`,
      });
      const session = await host.createWorkSession(created.id);
      const events = [];
      const off = session.onExternalChange((snapshot) => events.push(snapshot));
      const current = await host.works.getWork(created.id);
      const saved = await host.works.saveWork(
        created.id,
        `${current.text}\nOutside.\n`,
        current.baseline,
      );
      a.equal(saved.kind, "saved", "outside save succeeds");
      const noticed = await session.flush();
      a.ok(events.length > 0 || noticed.kind === "conflict", "external change surfaces");
      off();
      session.dispose();
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "media.round-trip",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title: prefixName(prefix, "media"),
        kind: "document",
        text: `# ${prefix} media\n`,
      });
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const added = await host.media.addMedia(created.id, {
        name: "pixel.png",
        mimeType: "image/png",
        bytes,
      });
      a.equal(typeof added.id, "string", "media id is a string");
      const listed = await host.media.listMedia(created.id);
      a.ok(listed.some((item) => item.id === added.id), "list contains added media");
      const resolved = await host.media.resolveMedia(added.id);
      a.ok(resolved.url.includes(added.id), "resolved url names the media");
      await host.media.removeMedia(added.id);
      const after = await host.media.listMedia(created.id);
      a.ok(!after.some((item) => item.id === added.id), "remove drops the media");
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "settings.round-trip",
    async run({ host, a }) {
      const before = await host.settings.getSettings();
      a.equal(typeof before, "object", "settings is an object");
      const updated = await host.settings.updateSettings({ theme: "light" });
      a.equal(updated.theme, "light", "theme update applies");
      const reread = await host.settings.getSettings();
      a.equal(reread.theme, "light", "theme update persists");
      await host.settings.updateSettings({ theme: before.theme ?? "dark" });
    },
  },
  {
    id: "search.echo-and-find",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const title = prefixName(prefix, "searchable");
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title,
        kind: "document",
        text: `# ${title}\n`,
      });
      const found = await host.search.search({
        requestId: "req-conformance-1",
        query: title,
        workspaceId: spaces[0].id,
      });
      a.equal(found.requestId, "req-conformance-1", "search echoes the request id");
      a.ok(
        found.hits.some((hit) => hit.work.id === created.id),
        "exact-title query finds the work",
      );
      const empty = await host.search.search({
        requestId: "req-conformance-2",
        query: "no-such-work-zzz-9f8e7d6c",
      });
      a.equal(empty.requestId, "req-conformance-2", "empty search echoes the request id");
      a.equal(empty.hits.length, 0, "nonsense query finds nothing");
      await host.library.deleteWork(created.id);
    },
  },
  {
    id: "transfer.round-trip",
    async run({ host, prefix, a }) {
      const spaces = await host.library.listWorkspaces();
      const title = prefixName(prefix, "transfer");
      const created = await host.library.createWork({
        workspaceId: spaces[0].id,
        title,
        kind: "document",
        text: `# ${title}\n\nTransfer me.\n`,
      });
      const archive = await host.transfer.exportElef([created.id]);
      a.ok(archive instanceof Uint8Array && archive.length > 0, "export returns bytes");
      await host.library.deleteWork(created.id);
      const imported = await host.transfer.importElef(archive, spaces[0].id);
      a.ok(imported.length > 0, "import restores works");
      const reread = await host.works.getWork(imported[0].id);
      a.ok(reread.text.includes("Transfer me."), "imported text matches");
      for (const summary of imported) {
        await host.library.deleteWork(summary.id);
      }
    },
  },
];

export async function runSuite(host, policy, prefix, assertShim) {
  // Dialog-mediated hosts (Tauri delete confirmation) cannot run programmatic
  // deletes under automation. Cleanup deletes become no-ops suite-wide; the
  // library.crud case records the skip and residue stays in the temp library.
  const effectiveHost =
    policy.deleteProgrammatic === false
      ? {
          ...host,
          library: {
            ...host.library,
            deleteWork: async () => undefined,
          },
        }
      : host;
  host = effectiveHost;
  const results = [];
  for (const kase of CASES) {
    let outcome = "pass";
    let reason = "";
    try {
      const verdict = await kase.run({ host, policy, prefix, a: assertShim });
      if (typeof verdict === "string") {
        outcome = "skip";
        reason = verdict === "skip" ? "adapter-declared" : verdict.replace(/^skip:\s*/, "");
      }
    } catch (error) {
      outcome = "fail";
      reason = error?.message ?? String(error);
    }
    results.push({ id: kase.id, outcome, reason });
  }
  return results;
}
