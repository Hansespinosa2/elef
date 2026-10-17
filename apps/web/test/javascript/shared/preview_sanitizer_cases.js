// Shared sanitizer corpus: every hostile/structural case the preview sink
// must handle, defined once and executed against the single @elef/client
// implementation. Each case lists install steps plus DOM checks in a fixed DSL:
//
//   { select?, index?, attribute?, equals?, absent?, text?, textAbsent?, exists?, count? }
//     select: querySelector(All) target (required except container text checks)
//     index: nth match for querySelectorAll (default 0)
//     attribute + equals: getAttribute(select) must deep-equal (null allowed)
//     attribute + absent: attribute must be missing
//     exists: true/false whether the selector matches at all
//     count: querySelectorAll(select).length must equal
//     text: with select, node.textContent must equal; without, container text trimmed
//     textAbsent: container.textContent must not include any listed string

export const CASES = [
  {
    name: "sink strips executable markup and remote image sources while preserving work-scoped media",
    installs: [
      {
        html: `
    <section data-controller="document-pages mermaid-diagrams">
      <div class="document-editor-block" data-editor-block-id="b1" data-editor-invoke="delete_work_folder" contenteditable="true" onclick="invoke('delete_work_folder')" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur">
        <img src="https://example.com/remote.png" onerror="invoke('delete_work_folder')">
        <img src="elefasset://localhost/id/sha" data-editor-image-source="true">
        <img src="elefasset://localhost/id/other" data-editor-image-source="delete_work_folder">
        <script>invoke('delete_work_folder')</script>
        <a href="javascript:alert(1)">bad</a>
      </div>
    </section>`,
        options: { mediaBaseUrl: "elefasset://localhost/id" },
      },
    ],
    checks: [
      { select: "section", attribute: "data-controller", equals: "document-pages mermaid-diagrams" },
      { select: "[data-editor-block-id]", attribute: "contenteditable", equals: "true" },
      { select: "[data-editor-block-id]", attribute: "onclick", equals: null },
      { select: "[data-editor-block-id]", attribute: "data-editor-invoke", absent: true },
      { select: "script", exists: false },
      { select: "img[src^='https://']", exists: false },
      { select: "img[src^='elefasset:']", attribute: "src", equals: "elefasset://localhost/id/sha" },
      { select: "img[src$='/other']", attribute: "data-editor-image-source", absent: true },
      { select: "a", attribute: "href", equals: null },
    ],
  },
  {
    name: "interactive preview keeps renderer-owned alignment controls and drops unknown actions",
    installs: [
      {
        html: `
    <label data-action="pointerdown->visual-editor#positionControlOpened">
      <select data-visual-editor-block-id="block-1" data-action="focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged">
        <option value="left">Left</option><option value="center">Center</option>
      </select>
    </label>
    <select data-presentation-editor-align data-slide-index="0" data-block-index="1" data-action="change->presentation-editor#alignmentChanged"></select>
    <button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="1">Move up</button>
    <button type="button" data-presentation-editor-action="move-block-up" data-slide-index="0" data-block-index="1">Move block up</button>
    <select data-visual-editor-block-id="bad id" data-action="change->hostile#invoke"></select>
    <button type="button" data-presentation-editor-action="invoke" data-slide-index="-1" data-block-index="not-an-index">Bad action</button>
    <button type="submit" data-presentation-editor-action="delete-slide" data-slide-index="0">Submit action</button>`,
        options: {},
      },
    ],
    checks: [
      { select: "label", attribute: "data-action", equals: "pointerdown->visual-editor#positionControlOpened" },
      {
        select: "[data-visual-editor-block-id='block-1']",
        attribute: "data-action",
        equals: "focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged",
      },
      { select: "[data-presentation-editor-align]", attribute: "data-action", equals: "change->presentation-editor#alignmentChanged" },
      { select: "[data-presentation-editor-align]", attribute: "data-slide-index", equals: "0" },
      { select: "[data-presentation-editor-align]", attribute: "data-block-index", equals: "1" },
      { select: "[data-presentation-editor-action='move-slide-up']", attribute: "data-slide-index", equals: "1" },
      { select: "[data-presentation-editor-action='move-block-up']", exists: false },
      { select: "select", index: 2, attribute: "data-action", absent: true },
      { select: "select", index: 2, attribute: "data-visual-editor-block-id", absent: true },
      { select: "button", count: 1 },
      { textAbsent: ["Bad action", "Submit action", "Move block up"] },
    ],
  },
  {
    name: "interactive preview keeps neutral editor contracts and drops unknown mounts",
    installs: [
      {
        html: `
    <button type="button" data-editor-action="media-choose-slide" data-slide-index="0">Add image</button>
    <span data-editor-action="overview-select" data-slide-index="1">Slide 2</span>
    <button type="button" data-editor-action="invoke">Bad</button>
    <div class="presentation-surface" data-client-mount="mermaid"></div>
    <div class="document-reader" data-client-mount="document-pages mermaid"><div class="document-surface"></div></div>
    <div data-client-mount="file-library"></div>`,
        options: {},
      },
    ],
    checks: [
      { select: "[data-editor-action='media-choose-slide']", attribute: "data-slide-index", equals: "0" },
      { select: "[data-editor-action='overview-select']", exists: true },
      { select: "[data-editor-action='invoke']", exists: false },
      { textAbsent: ["Bad"] },
      { select: ".presentation-surface", attribute: "data-client-mount", equals: "mermaid" },
      { select: ".document-reader", attribute: "data-client-mount", equals: "document-pages mermaid" },
      { select: "[data-client-mount='file-library']", exists: false },
    ],
  },
  {
    name: "sanitized renderer output retains the document editing controls",
    installs: [{ render: { source: "# Title\n\nA paragraph.", kind: "document" }, options: {} }],
    checks: [
      { select: "select[data-visual-editor-block-id], select[data-presentation-editor-align]", exists: true },
      { select: 'option[value="left"]', exists: true },
    ],
  },
  {
    name: "sanitized renderer output retains the presentation editing controls",
    installs: [{ render: { source: "# Title\n\nA paragraph.", kind: "presentation" }, options: {} }],
    checks: [
      { select: "button[data-presentation-editor-action]", exists: true },
      { select: ".presentation-surface", attribute: "data-presentation-editor-target", equals: "canvas" },
      { select: "select[data-visual-editor-block-id], select[data-presentation-editor-align]", exists: true },
      { select: 'option[value="left"]', exists: true },
    ],
  },
  {
    name: "sanitized renderer output keeps editable display math source",
    installs: [{ render: { source: "# Title\n\n$$\\sum_{i=1}^{n} i$$" }, options: {} }],
    checks: [
      { select: ".katex-display[data-editor-math-source]", exists: true },
      { select: ".katex-display[data-editor-math-source]", attribute: "contenteditable", equals: "false" },
      { select: ".katex-display math", attribute: "xmlns", equals: "http://www.w3.org/1998/Math/MathML" },
      { select: ".katex-display math", attribute: "display", equals: "block" },
      { select: ".katex-display munderover mo", text: "∑" },
      { select: ".katex-display mi", count: 3 },
      { select: ".katex-display annotation", attribute: "encoding", equals: "application/x-tex" },
      { select: ".katex-display annotation", text: "\\sum_{i=1}^{n} i" },
    ],
  },
  {
    name: "sanitized math keeps inert MathML attributes but drops remote fetches and unknown elements",
    installs: [
      {
        html: `
    <span class="katex" data-editor-math-source="x" data-editor-math-open="$" data-editor-math-close="$" contenteditable="false"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mo stretchy="true" minsize="1.2em">(</mo><mspace linebreak="newline"></mspace><menclose notation="box"><mi>x</mi></menclose><mpadded height="0em" voffset="0em" depth="0em"><mspace mathbackground="black" width="2em" height="0.431em"></mspace></mpadded><mglyph src="https://evil.example/x.png" alt="glyph" height="1em" valign="0em" onclick="invoke('x')"></mglyph><mscript>evil()</mscript></mrow></semantics></math></span>`,
        options: {},
      },
    ],
    checks: [
      { select: ".katex[data-editor-math-source]", exists: true },
      { select: "mo", attribute: "stretchy", equals: "true" },
      { select: "mo", attribute: "minsize", equals: "1.2em" },
      { select: "mspace", attribute: "linebreak", equals: "newline" },
      { select: "menclose", attribute: "notation", equals: "box" },
      { select: "mpadded", attribute: "voffset", equals: "0em" },
      { select: "mpadded", attribute: "depth", equals: "0em" },
      { select: "mglyph", exists: true },
      { select: "mglyph", attribute: "src", absent: true },
      { select: "mglyph", attribute: "alt", equals: "glyph" },
      { select: "mglyph", attribute: "onclick", absent: true },
      { select: "mscript", exists: false },
      { textAbsent: ["evil()"] },
    ],
  },
  {
    name: "sanitized renderer output preserves safe Markdown table alignment",
    installs: [{ render: { source: "| Left | Right |\n| :--- | ---: |\n| one | two |" }, options: {} }],
    checks: [
      { select: "th", attribute: "style", equals: "text-align:left" },
      { select: "th:nth-child(2)", attribute: "style", equals: "text-align:right" },
    ],
  },
  {
    name: "non-interactive library previews omit the renderer's editing controls",
    installs: [{ render: { source: "# Title\n\nA paragraph.", kind: "presentation" }, options: { interactive: false } }],
    checks: [{ select: "button, label, select, option", exists: false }],
  },
  {
    name: "preview sink keeps sanitized work media inside editable figure captions",
    installs: [
      {
        html: `
    <figure class="editor-media" onclick="invoke('delete_work_folder')">
      <img src="elefasset://localhost/id/sha" data-editor-image-source="true" onerror="invoke('delete_work_folder')">
      <figcaption class="editor-media-caption" aria-label="Editable image alt text">Diagram</figcaption>
    </figure>`,
        options: { mediaBaseUrl: "elefasset://localhost/id" },
      },
    ],
    checks: [
      { select: "figure", attribute: "onclick", equals: null },
      { select: "figure img", attribute: "src", equals: "elefasset://localhost/id/sha" },
      { select: "figure img", attribute: "onerror", equals: null },
      { select: "figure figcaption", text: "Diagram" },
      { select: "figure figcaption", attribute: "aria-label", equals: "Editable image alt text" },
    ],
  },
  {
    name: "desktop asset URLs are rejected unless they stay under the trusted work base",
    installs: [
      {
        html: `
    <img class="expected" src="elefasset://localhost/work/image.png">
    <img class="other-work" src="elefasset://localhost/other/image.png">
    <img class="traversal" src="elefasset://localhost/work/%2e%2e/other/image.png">`,
        options: { mediaBaseUrl: "elefasset://localhost/work" },
      },
    ],
    checks: [
      { select: ".expected", attribute: "src", equals: "elefasset://localhost/work/image.png" },
      { select: ".other-work", attribute: "src", absent: true },
      { select: ".traversal", attribute: "src", absent: true },
    ],
  },
  {
    name: "desktop asset URLs are rejected without a trusted work base",
    installs: [
      {
        html: '<img class="unscoped" src="elefasset://localhost/work/image.png">',
        options: {},
      },
    ],
    checks: [{ select: ".unscoped", attribute: "src", absent: true }],
  },
  {
    name: "non-interactive library previews remove controller and editing hooks",
    installs: [
      {
        html: `
    <section data-controller="mermaid-diagrams">
      <div contenteditable="true" data-action="input->visual-editor#projectionInput">safe text</div>
    </section>`,
        options: { interactive: false },
      },
    ],
    checks: [
      { select: "section", attribute: "data-controller", equals: null },
      { select: "[contenteditable]", exists: false },
      { select: "[data-action]", exists: false },
      { text: "safe text" },
    ],
  },
  {
    name: "non-interactive document cards preserve only the trusted page controller and its surface target",
    installs: [
      {
        html: `
    <div class="document-reader document-theme-dark" data-controller="document-pages mermaid-diagrams">
      <div class="document-surface" data-document-pages-target="surface">
        <p>Page content</p>
        <div class="hostile" data-controller="file-library" data-document-pages-target="surface">Injected controller</div>
        <div class="document-reader" data-controller="document-pages mermaid-diagrams">
          <div class="document-surface" data-document-pages-target="surface">Nested injected pagination</div>
        </div>
      </div>
    </div>`,
        options: { interactive: false, documentPagination: true },
      },
    ],
    checks: [
      { select: ".document-reader", attribute: "data-controller", equals: "document-pages mermaid-diagrams" },
      { select: ".document-surface", attribute: "data-document-pages-target", equals: "surface" },
      { select: ".hostile", attribute: "data-controller", equals: null },
      { select: ".hostile", attribute: "data-document-pages-target", equals: null },
      { select: "[data-controller]", count: 1 },
      { select: "[data-document-pages-target]", count: 1 },
    ],
  },
  {
    name: "non-document library previews cannot activate document pagination",
    installs: [
      {
        html: `
    <div class="document-reader" data-controller="document-pages mermaid-diagrams">
      <div class="document-surface" data-document-pages-target="surface">Presentation text</div>
    </div>`,
        options: { interactive: false },
      },
    ],
    checks: [
      { select: "[data-controller]", exists: false },
      { select: "[data-document-pages-target]", exists: false },
    ],
  },
]

export function runChecks(container, checks, assert) {
  for (const check of checks) {
    if (check.text !== undefined && check.select === undefined) {
      assert.equal(container.textContent.trim(), check.text)
      continue
    }
    if (check.textAbsent !== undefined) {
      for (const snippet of check.textAbsent) {
        assert.equal(container.textContent.includes(snippet), false, `must not contain ${snippet}`)
      }
      continue
    }
    const matches = [...container.querySelectorAll(check.select)]
    if (check.count !== undefined) {
      assert.equal(matches.length, check.count, `${check.select} count`)
      continue
    }
    if (check.exists !== undefined) {
      assert.equal(matches.length > 0, check.exists, `${check.select} existence`)
      continue
    }
    const node = matches[check.index ?? 0]
    assert.ok(node, `${check.select} matches`)
    if (check.text !== undefined) {
      assert.equal(node.textContent, check.text, `${check.select} text`)
      continue
    }
    if (check.absent === true) {
      assert.equal(node.hasAttribute(check.attribute), false, `${check.attribute} absent`)
    } else {
      assert.equal(node.getAttribute(check.attribute), check.equals, `${check.attribute} value`)
    }
  }
}
