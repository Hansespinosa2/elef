const MOUNT_CONTROLLERS = {
  mermaid: "mermaid-diagrams",
  "document-pages": "document-pages"
};
function clientMountController(token) {
  return MOUNT_CONTROLLERS[token] ?? null;
}
function translateElementMounts(element) {
  const mounts = (element.getAttribute?.("data-client-mount") || "").split(/\s+/).filter(Boolean);
  const controllers = mounts.flatMap((mount) => clientMountController(mount) ?? []);
  if (!controllers.length) return false;
  const existing = (element.getAttribute("data-controller") || "").split(/\s+/).filter(Boolean);
  controllers.forEach((identifier) => {
    if (!existing.includes(identifier)) existing.push(identifier);
  });
  element.setAttribute("data-controller", existing.join(" "));
  return true;
}
function translateClientMounts(root) {
  if (!root?.querySelectorAll) return 0;
  let translated = 0;
  if (root.hasAttribute?.("data-client-mount") && translateElementMounts(root)) translated += 1;
  root.querySelectorAll("[data-client-mount]").forEach((element) => {
    if (translateElementMounts(element)) translated += 1;
  });
  return translated;
}
const startedTargets = /* @__PURE__ */ new WeakSet();
function startClientMounts(target = globalThis.document ?? null) {
  if (!target || typeof MutationObserver === "undefined" || startedTargets.has(target)) return false;
  startedTargets.add(target);
  translateClientMounts(target);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        if (mutation.attributeName === "data-client-mount" && mutation.target.nodeType === 1) {
          translateElementMounts(mutation.target);
        }
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        translateClientMounts(node);
      });
    });
  }).observe(target.documentElement ?? target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-client-mount"]
  });
  return true;
}
export {
  clientMountController,
  startClientMounts,
  translateClientMounts,
  translateElementMounts
};
