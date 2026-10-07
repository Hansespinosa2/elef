// Minimal shared client shell: the host-neutral interactive root behind the
// Phase 01 contract. It renders through the host ports only, branches on
// capabilities (never host names), and owns no persistence itself.

export async function mountElef(hostElement, host, options = {}) {
  const state = { disposed: false };
  const root = hostElement.ownerDocument.createElement("div");
  root.setAttribute("data-elef-shell", "true");
  hostElement.appendChild(root);

  function line(text) {
    const paragraph = hostElement.ownerDocument.createElement("p");
    paragraph.textContent = text;
    root.appendChild(paragraph);
    return paragraph;
  }

  line("Elef");
  const statusLine = line("Loading…");

  async function render() {
    if (state.disposed) return;
    while (root.childNodes.length > 2) root.removeChild(root.lastChild);
    const spaces = await host.library.listWorkspaces();
    const list = hostElement.ownerDocument.createElement("ul");
    for (const space of spaces) {
      const works = await host.library.listWorks(space.id);
      for (const work of works) {
        const item = hostElement.ownerDocument.createElement("li");
        item.textContent = `${work.title} (${work.kind})`;
        item.setAttribute("data-work-id", work.id);
        list.appendChild(item);
      }
    }
    root.appendChild(list);
    if (host.capabilities.updater) {
      const updater = hostElement.ownerDocument.createElement("button");
      updater.textContent = "Check for updates";
      updater.setAttribute("data-elef-updates", "true");
      root.appendChild(updater);
    }
    const shown = list.querySelectorAll ? list.querySelectorAll("li").length : 0;
    statusLine.textContent = `Library ready (${shown} works)`;
    if (options.initialUrl) {
      const link = hostElement.ownerDocument.createElement("p");
      link.textContent = options.initialUrl;
      link.setAttribute("data-elef-initial-url", "true");
      root.appendChild(link);
    }
  }

  await render();

  return {
    async refresh() {
      await render();
    },
    unmount() {
      state.disposed = true;
      root.remove();
    },
  };
}
