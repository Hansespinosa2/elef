// ElefHost over HTTP against the Rails host API (app/controllers/host_api_controller.rb)
// plus the existing JSON asset, search, settings-transfer and export routes.
// Transport policy: single default workspace, CSRF via meta token plus a
// minimal cookie jar, modern browser user agent for allow_browser.

export const railsPolicy = {
  deleteProgrammatic: true,
};

const MODERN_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function csrfToken(html) {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  return match ? match[1] : null;
}

export async function createRailsHost({ baseUrl, fetchImpl = fetch }) {
  const cookies = new Map();
  const base = baseUrl.replace(/\/$/, "");

  function storeCookies(response) {
    const headers =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    for (const header of headers) {
      const pair = header.split(";")[0].trim();
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  function cookieHeader() {
    return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async function bootstrap() {
    // The test environment disables forgery protection, so csrf_meta_tags
    // renders nothing there; the token is required only when present.
    // Anything that is not the app page is still a hard failure.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(`${base}/`, { headers: { "User-Agent": MODERN_UA } });
      storeCookies(response);
      const html = await response.text();
      const token = csrfToken(html);
      if (token) return token;
      if (response.status === 200 && html.includes("<title>Elef library</title>")) return null;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
      else {
        throw new Error(
          `rails host bootstrap failed: status ${response.status}, ` +
            `content-type ${response.headers.get("content-type")}, ` +
            `body head ${JSON.stringify(html.slice(0, 300))}`,
        );
      }
    }
    throw new Error("rails host bootstrap failed unexpectedly");
  }

  const csrf = await bootstrap();

  async function request(path, { method = "GET", json, form, accept = "application/json" } = {}) {
    const headers = { "User-Agent": MODERN_UA, Accept: accept };
    const jar = cookieHeader();
    if (jar) headers.Cookie = jar;
    let body;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      body = form;
    }
    const response = await fetchImpl(`${base}${path}`, { method, headers, body });
    storeCookies(response);
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error ?? `rails host ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }
    if (!response.ok) {
      throw new Error(`rails host ${response.status} for ${method} ${path}`);
    }
    return response;
  }

  async function requestBytes(path) {
    const response = await request(path, { accept: "*/*" });
    return new Uint8Array(await response.arrayBuffer());
  }

  function segment(kind) {
    return kind === "presentation" ? "presentations" : "documents";
  }

  const sessions = new Map();

  function toSummary(payload) {
    return { id: String(payload.id), workspaceId: String(payload.workspace_id), title: payload.title, kind: payload.kind };
  }

  function toSnapshot(payload) {
    return { ...toSummary(payload), text: payload.text, baseline: { revision: String(payload.baseline.revision) } };
  }

  const library = {
    async listWorkspaces() {
      return [{ id: "default", name: "Workspace" }];
    },
    async listWorks(workspaceId) {
      const payload = await request(`/api/host/works?workspace_id=${encodeURIComponent(workspaceId)}`);
      return payload.map(toSummary);
    },
    async createWork(input) {
      const payload = await request("/api/host/works", {
        method: "POST",
        json: {
          workspace_id: input.workspaceId,
          title: input.title,
          kind: input.kind,
          text: input.text ?? null,
        },
      });
      return toSummary(payload);
    },
    async renameWork(workId, title) {
      const payload = await request(`/api/host/works/${encodeURIComponent(workId)}/rename`, {
        method: "PATCH",
        json: { title },
      });
      return toSummary(payload);
    },
    async deleteWork(workId) {
      await request(`/api/host/works/${encodeURIComponent(workId)}`, { method: "DELETE" });
    },
  };

  const worksPort = {
    async getWork(workId) {
      return toSnapshot(await request(`/api/host/works/${encodeURIComponent(workId)}`));
    },
    async saveWork(workId, text, baseline) {
      try {
        const payload = await request(`/api/host/works/${encodeURIComponent(workId)}`, {
          method: "PATCH",
          json: { text, baseline_revision: baseline.revision },
        });
        return { kind: "saved", baseline: { revision: String(payload.baseline.revision) } };
      } catch (error) {
        if (error.status === 409 && error.payload?.current) {
          return { kind: "conflict", current: toSnapshot(error.payload.current) };
        }
        throw error;
      }
    },
  };

  function createSession(workId) {
    const session = {
      workId,
      kind: null,
      text: "",
      revision: null,
      ready: null,
      statusHandlers: new Set(),
      externalHandlers: new Set(),
      disposed: false,
      ensure() {
        if (!this.ready) {
          this.ready = worksPort.getWork(workId).then((snapshot) => {
            this.kind = snapshot.kind;
            this.text = snapshot.text;
            this.revision = snapshot.baseline.revision;
            return snapshot;
          });
        }
        return this.ready;
      },
      getText() {
        return this.text;
      },
      applyLocalChange(change) {
        this.text = this.text.slice(0, change.from) + change.insert + this.text.slice(change.to);
        this.emitStatus({ kind: "dirty" });
      },
      replaceText(text) {
        this.text = text;
        this.emitStatus({ kind: "dirty" });
      },
      onExternalChange(handler) {
        this.externalHandlers.add(handler);
        return () => this.externalHandlers.delete(handler);
      },
      onStatus(handler) {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
      },
      emitStatus(status) {
        for (const handler of this.statusHandlers) handler(status);
      },
      async flush() {
        if (this.disposed) {
          return { kind: "failed", error: { category: "invalid_input", message: "session disposed", retryable: false } };
        }
        await this.ensure();
        const live = await worksPort.getWork(workId);
        if (live.text === this.text && live.baseline.revision === this.revision) {
          return { kind: "clean", baseline: live.baseline };
        }
        this.emitStatus({ kind: "saving" });
        const result = await worksPort.saveWork(workId, this.text, { revision: this.revision });
        if (result.kind === "saved") {
          this.revision = result.baseline.revision;
          this.emitStatus({ kind: "clean" });
          return result;
        }
        const current = result.current;
        for (const handler of this.externalHandlers) handler(current);
        this.emitStatus({ kind: "clean" });
        return result;
      },
      dispose() {
        this.disposed = true;
      },
    };
    sessions.set(workId, session);
    return session;
  }

  const mediaPort = {
    async listMedia(workId) {
      const payload = await request(`/api/host/works/${encodeURIComponent(workId)}/media`);
      return payload.map((item) => ({
        id: String(item.digest),
        workId: String(workId),
        name: item.name,
        mimeType: item.mime_type,
      }));
    },
    async addMedia(workId, input) {
      const snapshot = await worksPort.getWork(workId);
      const form = new FormData();
      form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.name);
      const payload = await request(`/${segment(snapshot.kind)}/${encodeURIComponent(workId)}/assets`, {
        method: "POST",
        form,
      });
      return {
        id: String(payload.digest),
        workId: String(workId),
        name: input.name,
        mimeType: input.mimeType,
      };
    },
    async removeMedia(mediaId) {
      const found = await findOwningWork(mediaId);
      await request(
        `/api/host/works/${encodeURIComponent(found.workId)}/media/${encodeURIComponent(mediaId)}`,
        { method: "DELETE" },
      );
    },
    async resolveMedia(mediaId) {
      const found = await findOwningWork(mediaId);
      const snapshot = await worksPort.getWork(found.workId);
      return {
        id: String(mediaId),
        workId: String(found.workId),
        name: found.name,
        mimeType: found.mimeType,
        url: `${base}/${segment(snapshot.kind)}/${encodeURIComponent(found.workId)}/assets/${encodeURIComponent(mediaId)}`,
      };
    },
  };

  async function findOwningWork(mediaId) {
    const spaces = await library.listWorkspaces();
    for (const space of spaces) {
      const works = await library.listWorks(space.id);
      for (const summary of works) {
        const items = await mediaPort.listMedia(summary.id);
        const match = items.find((item) => item.id === mediaId);
        if (match) return match;
      }
    }
    const error = new Error("media not found");
    error.status = 404;
    throw error;
  }

  const settingsPort = {
    async getSettings() {
      return request("/api/host/settings");
    },
    async updateSettings(patch) {
      return request("/api/host/settings", { method: "PATCH", json: patch });
    },
  };

  const searchPort = {
    async search(input) {
      const params = new URLSearchParams({ q: input.query, limit: "30" });
      const payload = await request(`/search?${params.toString()}`);
      const hits = (payload.results ?? []).map((result) => ({
        work: {
          id: String(result.id),
          workspaceId: String(input.workspaceId ?? "default"),
          title: result.title,
          kind: result.type === "presentation" ? "presentation" : "document",
        },
        excerpt: typeof result.context === "string" ? result.context : undefined,
      }));
      return { requestId: input.requestId, hits };
    },
  };

  const transferPort = {
    async exportElef(workIds) {
      const chunks = [];
      for (const workId of workIds) {
        const snapshot = await worksPort.getWork(workId);
        chunks.push(await requestBytes(`/${segment(snapshot.kind)}/${encodeURIComponent(workId)}/export`));
      }
      const total = chunks.reduce((sum, part) => sum + part.length, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) {
        bytes.set(part, offset);
        offset += part.length;
      }
      return bytes;
    },
    async importElef(bytes, workspaceId) {
      const form = new FormData();
      form.append("package", new Blob([bytes], { type: "application/zip" }), "import.elef-work.zip");
      const payload = await request(`/api/host/imports?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        form,
      });
      return [toSummary(payload)];
    },
  };

  return {
    capabilities: {
      accounts: false,
      collaboration: false,
      entitlements: false,
      updater: false,
      nativeMenus: false,
      localFilesystem: false,
    },
    library,
    works: worksPort,
    media: mediaPort,
    settings: settingsPort,
    search: searchPort,
    transfer: transferPort,
    async createWorkSession(workId) {
      const session = createSession(workId);
      await session.ensure();
      return session;
    },
  };
}
