const registries = new WeakMap()

export function authoringRegistryFor(element) {
  if (!registries.has(element)) {
    try {
      registries.set(element, JSON.parse(element.dataset.authoringRegistry || "[]"))
    } catch (_error) {
      registries.set(element, [])
    }
  }
  return registries.get(element)
}

export function setAuthoringRegistryFor(element, entries) {
  const registry = Array.isArray(entries) ? entries : []
  registries.set(element, registry)
  return registry
}
