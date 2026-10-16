// Repository-Dev editor runtime: the full editor-runtime dist registers
// every controller, and Dev mounts the shared presentation visual editor.
import { mountHostPresentationEditor, registerEditorRuntime } from "@elef/editor-runtime"

export { registerEditorRuntime }

export const presentationEditorRuntime = Object.freeze({
  mount: mountHostPresentationEditor
})
