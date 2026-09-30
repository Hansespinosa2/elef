# Pin npm packages by running ./bin/importmap

pin "application"
pin "bug_report_events", to: "bug_report_events.js"
pin "@hotwired/turbo-rails", to: "turbo.min.js"
pin "@hotwired/stimulus", to: "stimulus.min.js"
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
pin "katex", to: "katex.js" # Provided by the katex gem for consistent client-side live math
pin "mermaid", to: "mermaid.min.js" # @11.17.2 Vendored self-contained build; exposes globalThis.mermaid like katex
