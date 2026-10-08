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
pin "@codemirror/lang-css", to: "@codemirror--lang-css.js" # @6.3.1
pin "@codemirror/lang-html", to: "@codemirror--lang-html.js" # @6.4.12
pin "@codemirror/lang-javascript", to: "@codemirror--lang-javascript.js" # @6.2.5
pin "@codemirror/language", to: "@codemirror--language.js" # @6.12.4
pin "@codemirror/lint", to: "@codemirror--lint.js" # @6.9.7
pin "@codemirror/search", to: "@codemirror--search.js" # @6.7.2
pin "@codemirror/state", to: "@codemirror--state.js" # @6.7.5
pin "@codemirror/view", to: "@codemirror--view.js" # @6.43.12
pin "@lezer/common", to: "@lezer--common.js" # @1.5.2
pin "@lezer/css", to: "@lezer--css.js" # @1.3.6
pin "@lezer/highlight", to: "@lezer--highlight.js" # @1.2.3
pin "@lezer/html", to: "@lezer--html.js" # @1.3.13
pin "@lezer/javascript", to: "@lezer--javascript.js" # @1.5.5
pin "@lezer/lr", to: "@lezer--lr.js" # @1.4.10
pin "@lezer/markdown", to: "@lezer--markdown.js" # @1.7.2
pin "@marijn/find-cluster-break", to: "@marijn--find-cluster-break.js" # @1.0.3
pin "@replit/codemirror-vim-core", to: "@replit--codemirror-vim-core.js" # @0.1.0
pin "crelt" # @1.0.7
pin "style-mod" # @4.1.4
pin "w3c-keyname" # @2.2.8
pin "katex", to: "katex.js" # @0.18.7 Shared Rails and desktop browser runtime
pin "elef-renderer", to: "elef-renderer.bundle.js"
pin "mermaid", to: "mermaid.min.js" # @11.17.2 Vendored self-contained build; exposes globalThis.mermaid

pin "lib/editor_document_state", to: "lib/editor_document_state.js"
pin "lib/vim_line_numbers", to: "lib/vim_line_numbers.js"
pin "lib/document_graph_view", to: "lib/document_graph_view.js"
pin "@elef/work-model", to: "work-model/src/index.js"
pin "lib/editor_controller_lookup", to: "lib/editor_controller_lookup.js"
pin "lib/editor_view", to: "lib/editor_view.js"
pin "#elef/preview-sanitizer", to: "lib/preview_sanitizer.js"
pin "lib/library_view", to: "lib/library_view.js"
pin "lib/library_filter", to: "lib/library_filter.js"
pin "lib/presentation_navigation", to: "lib/presentation_navigation.js"
pin "lib/projection_editability", to: "lib/projection_editability.js"
pin "lib/preview_request_body", to: "lib/preview_request_body.js"
pin "lib/vim_settings_view", to: "lib/vim_settings_view.js"
pin "lib/save_flow", to: "lib/save_flow.js"
pin "lib/editor_source", to: "lib/editor_source.js"
pin "#elef/authoring-settings", to: "lib/authoring_settings.js"
pin "#elef/authoring-registry-write", to: "lib/authoring_registry_write.js"
pin "lib/authoring_settings_dialog", to: "lib/authoring_settings_dialog.js"
pin "lib/rails_authoring_settings_transport", to: "lib/rails_authoring_settings_transport.js"
pin "lib/editor_ready", to: "lib/editor_ready.js"
pin "lib/conflict_dialog", to: "lib/conflict_dialog.js"
