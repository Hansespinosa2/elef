# Pin npm packages by running ./bin/importmap

pin "application"
pin "bug_report_events", to: "bug_report_events.js"
pin "@hotwired/turbo-rails", to: "turbo.min.js"
pin "@hotwired/stimulus", to: "stimulus.min.js" # @3.2.2
pin "@hotwired/stimulus-loading", to: "stimulus-loading.js"
pin_all_from "app/javascript/controllers", under: "controllers"
pin "@codemirror/lang-markdown", to: "@codemirror--lang-markdown.js" # @6.5.2
pin "@replit/codemirror-vim", to: "@replit--codemirror-vim.js" # @6.4.0
pin "codemirror" # @6.0.2
pin "@codemirror/autocomplete", to: "@codemirror--autocomplete.js" # @6.20.3
pin "@codemirror/commands", to: "@codemirror--commands.js" # @6.11.1
pin "@codemirror/lang-css", to: "@codemirror--lang-css.js", preload: false # @6.3.1 unused on edit pages; fetch on demand
pin "@codemirror/lang-html", to: "@codemirror--lang-html.js", preload: false # @6.4.12 unused on edit pages; fetch on demand
pin "@codemirror/lang-javascript", to: "@codemirror--lang-javascript.js", preload: false # @6.2.5 unused on edit pages; fetch on demand
pin "@codemirror/language", to: "@codemirror--language.js" # @6.12.4
pin "@codemirror/lint", to: "@codemirror--lint.js" # @6.9.7
pin "@codemirror/search", to: "@codemirror--search.js" # @6.7.2
pin "@codemirror/state", to: "@codemirror--state.js" # @6.7.5
pin "@codemirror/view", to: "@codemirror--view.js" # @6.43.12
pin "@lezer/common", to: "@lezer--common.js" # @1.5.2
pin "@lezer/css", to: "@lezer--css.js", preload: false # @1.3.6 unused on edit pages; fetch on demand
pin "@lezer/highlight", to: "@lezer--highlight.js" # @1.2.3
pin "@lezer/html", to: "@lezer--html.js", preload: false # @1.3.13 unused on edit pages; fetch on demand
pin "@lezer/javascript", to: "@lezer--javascript.js", preload: false # @1.5.5 unused on edit pages; fetch on demand
pin "@lezer/lr", to: "@lezer--lr.js" # @1.4.10
pin "@lezer/markdown", to: "@lezer--markdown.js" # @1.7.2
pin "@marijn/find-cluster-break", to: "@marijn--find-cluster-break.js" # @1.0.3
pin "@replit/codemirror-vim-core", to: "@replit--codemirror-vim-core.js" # @0.1.0
pin "crelt" # @1.0.7
pin "style-mod" # @4.1.4
pin "w3c-keyname" # @2.2.8
pin "katex", to: "katex.js", preload: false # @0.18.7 ESM build, esbuild-minified in place (262K vs 589K); deferred: live math loads it post-settle, never on open
pin "elef-renderer", to: "renderer/dist/elef-renderer.bundle.js", preload: false # client-shell pages only; fetch on mount
pin "mermaid", to: "mermaid.min.js", preload: false # @11.17.2 classic script injected only when diagrams exist; never blanket-fetch 3.5MB

pin "@elef/client", to: "client/dist/elef-client.js"
pin "@elef/client/preview-core", to: "client/dist/preview-core.js", preload: false # deferred card-preview renderer (KaTeX, highlight.js); library interactions fetch on demand
pin "@elef/client/sanitize", to: "client/dist/sanitize.js"
pin "@elef/client/presentation-chrome", to: "client/dist/presentation-chrome.js"
pin "@elef/client/vim-preferences", to: "client/dist/vim-preferences.js"
pin "@elef/client/editor", to: "client/dist/editor.js" # CodeMirror editing engine shared by the editor shell
pin "host/rails-http-host", to: "host/rails-http-host.js", preload: false # client-shell pages only; fetch on mount
pin "host/rails-authoring-settings-transport", to: "host/rails-authoring-settings-transport.js", preload: false # client-shell pages only; fetch on mount
pin "bug_report_response", to: "bug_report_response.js"
pin "@elef/work-model", to: "work-model/dist/elef-work-model.js", preload: false # map barrel; open path uses style-vocab only, barrel fetches on demand
pin "@elef/work-model/document-map", to: "work-model/dist/document-map.js", preload: false # export/library paths only; open path uses style-vocab
pin "@elef/work-model/document-links", to: "work-model/dist/document-links.js", preload: false # export/library paths only; fetch on demand
pin "@elef/work-model/document-transforms", to: "work-model/dist/document-transforms.js"
pin "@elef/work-model/art-source", to: "work-model/dist/art-source.js", preload: false # renderer/export paths only; fetch on demand
pin "@elef/work-model/slide-position-layout", to: "work-model/dist/slide-position-layout.js", preload: false # export paths only; fetch on demand
pin "@elef/work-model/style-vocab", to: "work-model/dist/style-vocab.js" # dependency-free vocab + front-matter read/write (open-path safe)
pin "@elef/editor-runtime", to: "editor-runtime/dist/index.js"
pin "@elef/editor-runtime/editor-chrome", to: "editor-runtime/dist/preview_chrome.js"
pin "@elef/editor-runtime/art-layout", to: "editor-runtime/dist/lib/art_layout.js", preload: false # unreferenced on web today; fetch on demand
