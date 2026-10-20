// Register controllers from the importmap via controllers/**/*_controller.
// A controller module is fetched the first time a matching data-controller
// appears in the DOM, so a page only parses the controllers it actually mounts.
import { application, registerEditorRuntime } from "@elef/editor-runtime"
import { lazyLoadControllersFrom } from "@hotwired/stimulus-loading"
// The shared editor controllers register explicitly (the desktop awaits the
// same call inside its bootstrap); the remaining host controllers below keep
// lazy-loading on first matching data-controller.
void registerEditorRuntime()
lazyLoadControllersFrom("controllers", application)
