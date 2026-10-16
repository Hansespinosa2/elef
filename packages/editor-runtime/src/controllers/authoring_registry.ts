import type { Application } from "@hotwired/stimulus";

const registries = new WeakMap<object, unknown[]>()

export function authoringRegistryFor(element: Element): unknown[] | undefined {
  if (!registries.has(element)) {
    try {
      registries.set(element, JSON.parse((element as HTMLElement).dataset.authoringRegistry || "[]"))
    } catch (_error) {
      registries.set(element, [])
    }
  }
  return registries.get(element)
}

export function setAuthoringRegistryFor(element: Element, entries: unknown): unknown[] {
  const registry = Array.isArray(entries) ? entries : []
  registries.set(element, registry)
  return registry
}

export function applyAuthoringRegistryToEditor(entries: unknown, {
  root = globalThis.document,
  application = globalThis.Stimulus
}: {
  root?: Document | null;
  application?: Application | null;
} = {}): unknown[] {
  const field = root?.querySelector<HTMLElement>(".source-field")
  if (!field) return Array.isArray(entries) ? entries : []

  const registry = setAuthoringRegistryFor(field, entries)
  field.dataset.authoringRegistry = JSON.stringify(registry)
  for (const identifier of ["snippet-palette", "math-shortcut-palette"]) {
    const controller = application?.getControllerForElementAndIdentifier(field, identifier)
    if (controller) controller.registry = registry
  }
  return registry
}
