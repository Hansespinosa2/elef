const registries = /* @__PURE__ */ new WeakMap();
function authoringRegistryFor(element) {
  if (!registries.has(element)) {
    try {
      registries.set(element, JSON.parse(element.dataset.authoringRegistry || "[]"));
    } catch (_error) {
      registries.set(element, []);
    }
  }
  return registries.get(element);
}
function setAuthoringRegistryFor(element, entries) {
  const registry = Array.isArray(entries) ? entries : [];
  registries.set(element, registry);
  return registry;
}
function applyAuthoringRegistryToEditor(entries, {
  root = globalThis.document,
  application = globalThis.Stimulus
} = {}) {
  const field = root?.querySelector(".source-field");
  if (!field) return Array.isArray(entries) ? entries : [];
  const registry = setAuthoringRegistryFor(field, entries);
  field.dataset.authoringRegistry = JSON.stringify(registry);
  for (const identifier of ["snippet-palette", "math-shortcut-palette"]) {
    const controller = application?.getControllerForElementAndIdentifier(field, identifier);
    if (controller) controller.registry = registry;
  }
  return registry;
}
export {
  applyAuthoringRegistryToEditor,
  authoringRegistryFor,
  setAuthoringRegistryFor
};
