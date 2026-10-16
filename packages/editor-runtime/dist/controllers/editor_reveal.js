const stashes = /* @__PURE__ */ new WeakMap();
const REVEALABLE_SELECTOR = "em, strong, del, s, code, a, span.document-link.unresolved";
const ACTIVE_SELECTOR = "[data-editor-inline-active='true']";
const ATOM_SELECTOR = "[data-editor-math-source], [data-editor-math-active], img, [data-editor-image-source]";
const ELEMENT_NODE = 1;
function elementKind(element) {
  const tag = element.tagName.toUpperCase();
  if (tag === "EM" || tag === "STRONG" || tag === "DEL" || tag === "S") return "format";
  if (tag === "CODE" && !element.closest("pre")) return "code";
  if (tag === "A") {
    if (element.classList.contains("document-link")) return "document_link";
    if (isAutolink(element)) return null;
    return "link";
  }
  if (tag === "SPAN" && element.classList.contains("document-link")) return "document_link";
  return null;
}
function isAutolink(anchor) {
  const text = (anchor.textContent ?? "").trim();
  const href = anchor.getAttribute("href") ?? "";
  if (!text || !href) return false;
  return href === text || href === `http://${text}` || href === `https://${text}` || href === `ftp://${text}` || href === `mailto:${text}`;
}
function tokenizeRevealables(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    const skip = opaqueLengthAt(source, index);
    if (skip > 0) {
      index += skip;
      continue;
    }
    const token = revealTokenAt(source, index);
    if (!token) {
      index += 1;
      continue;
    }
    tokens.push(token);
    index = token.end;
  }
  return tokens;
}
function opaqueLengthAt(source, index) {
  const rest = source.slice(index);
  const image = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
  if (image) return (image[0] ?? "").length;
  const displayBracket = rest.match(/^\\\[([\s\S]+?)\\\]/);
  if (displayBracket) return (displayBracket[0] ?? "").length;
  const inlineParen = rest.match(/^\\\(([^\\\r\n]+?)\\\)/);
  if (inlineParen) return (inlineParen[0] ?? "").length;
  const displayDollar = rest.match(/^\$\$([\s\S]+?)\$\$(?!\$)/);
  if (displayDollar) return (displayDollar[0] ?? "").length;
  if (source[index - 1] !== "$") {
    const inlineDollar = rest.match(/^\$(?!\$)(?!\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/);
    if (inlineDollar) return (inlineDollar[0] ?? "").length;
  }
  return 0;
}
function revealTokenAt(source, index) {
  const rest = source.slice(index);
  const code = rest.match(/^(`+)([^`\r\n]+?)\1/);
  if (code?.[1] !== void 0) {
    return { kind: "code", start: index, end: index + code[0].length, open: code[1], close: code[1] };
  }
  for (const delimiter of ["**", "__", "~~"]) {
    if (!rest.startsWith(delimiter)) continue;
    const end = rest.indexOf(delimiter, delimiter.length);
    if (end < 0) continue;
    const content = rest.slice(delimiter.length, end);
    if (!content || /^\s|\s$/.test(content) || content.includes("\n")) continue;
    const formatType = delimiter === "~~" ? "strike" : "strong";
    return { kind: "format", formatType, start: index, end: index + end + delimiter.length, open: delimiter, close: delimiter };
  }
  for (const delimiter of ["*", "_"]) {
    if (!rest.startsWith(delimiter)) continue;
    if (rest[1] === delimiter) continue;
    const end = rest.indexOf(delimiter, 1);
    if (end < 0) continue;
    const content = rest.slice(1, end);
    if (!content || /^\s|\s$/.test(content) || content.includes("\n")) continue;
    return { kind: "format", formatType: "emphasis", start: index, end: index + end + 1, open: delimiter, close: delimiter };
  }
  const link = rest.match(/^(\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\))/);
  if (link) {
    return { kind: "link", start: index, end: index + (link[0] ?? "").length, open: "[", close: ")" };
  }
  const documentLink = rest.match(/^(\[\[([^\]|]+)(?:\|([^\]]*))?\]\])/);
  if (documentLink) {
    return { kind: "document_link", start: index, end: index + (documentLink[0] ?? "").length, open: "[[", close: "]]" };
  }
  return null;
}
function outermostRevealables(root) {
  const candidates = [...root.querySelectorAll(`${REVEALABLE_SELECTOR}, ${ACTIVE_SELECTOR}`)];
  const found = [];
  for (const element of candidates) {
    if (element.closest?.(ATOM_SELECTOR)) continue;
    if (element.matches?.(ACTIVE_SELECTOR)) {
      found.push(element);
      continue;
    }
    if (elementKind(element) === null) continue;
    if (element.closest?.(ACTIVE_SELECTOR)) continue;
    const ancestor = element.parentElement?.closest?.(REVEALABLE_SELECTOR);
    if (ancestor && root.contains(ancestor)) continue;
    found.push(element);
  }
  return found;
}
function pairRevealables(source, root) {
  const tokens = tokenizeRevealables(source);
  const elements = outermostRevealables(root);
  if (tokens.length !== elements.length) return null;
  const pairs = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const element = elements[i];
    const activeSpan = element.matches?.(ACTIVE_SELECTOR) ? element : null;
    const kind = activeSpan ? activeSpan.dataset.editorInlineKind : elementKind(element);
    if (!kind || kind !== token.kind) return null;
    if (kind === "format" && activeSpan) {
      const formatType = activeSpan.dataset.editorInlineFormat;
      if (formatType && formatType !== token.formatType) return null;
    }
    pairs.push({ token, element, activeSpan });
  }
  return pairs;
}
function delimitersMatch(token, text) {
  return text.startsWith(token.open) && text.endsWith(token.close) && text.length >= token.open.length + token.close.length;
}
function offsetInElement(element, node, offset) {
  let seen = 0;
  let found = null;
  const visit = (current) => {
    if (found !== null) return;
    if (current === node) {
      if (current.nodeType === ELEMENT_NODE) {
        let sum = 0;
        const kids = [...current.childNodes ?? []];
        for (let i = 0; i < Math.min(offset, kids.length); i += 1) sum += (kids[i].textContent ?? "").length;
        found = seen + sum;
      } else {
        found = seen + Math.min(offset, (current.textContent ?? "").length);
      }
      return;
    }
    if (current.nodeType !== ELEMENT_NODE) {
      seen += (current.textContent ?? "").length;
      return;
    }
    for (const child of [...current.childNodes ?? []]) visit(child);
  };
  visit(element);
  return found;
}
function intersects(element, range) {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
}
function touchedPair(pairs, root, node) {
  if (!node) return null;
  const element = node.nodeType === ELEMENT_NODE ? node : node.parentElement;
  const active = element?.closest?.(ACTIVE_SELECTOR);
  if (active && root.contains(active)) {
    return pairs.find((pair) => pair.activeSpan === active) ?? null;
  }
  const revealable = element?.closest?.(REVEALABLE_SELECTOR);
  if (!revealable || !root.contains(revealable)) return null;
  if (revealable.closest?.(ACTIVE_SELECTOR)) return null;
  return pairs.find((pair) => pair.element === revealable || pair.element.contains(revealable)) ?? null;
}
function activatePair(pair, source, selection) {
  const { token, element } = pair;
  if (element.matches?.(ACTIVE_SELECTOR)) return element;
  if ((token.kind === "link" || token.kind === "document_link") && element.tagName.toUpperCase() !== "A") return null;
  if (element.querySelector?.(ATOM_SELECTOR)) return null;
  const slice = source.slice(token.start, token.end);
  if (!delimitersMatch(token, slice)) return null;
  const doc = element.ownerDocument;
  const remap = (node, offset) => {
    if (!node) return null;
    const inner = offsetInElement(element, node, offset);
    return inner === null ? null : inner + token.open.length;
  };
  const anchor = selection && selection.rangeCount > 0 ? remap(selection.anchorNode, selection.anchorOffset) : null;
  const focus = selection && selection.rangeCount > 0 ? remap(selection.focusNode, selection.focusOffset) : null;
  const span = doc.createElement("span");
  span.className = "editor-inline-active";
  span.dataset.editorInlineActive = "true";
  span.dataset.editorInlineKind = token.kind;
  if (token.formatType) span.dataset.editorInlineFormat = token.formatType;
  span.dataset.editorInlineSource = slice;
  span.spellcheck = false;
  const textNode = doc.createTextNode(slice);
  span.appendChild(textNode);
  stashes.set(span, { original: element, baseline: slice });
  element.parentNode?.replaceChild(span, element);
  const liveAnchorNode = selection?.anchorNode ?? null;
  const liveFocusNode = selection?.focusNode ?? null;
  if (selection && liveAnchorNode && liveFocusNode && (anchor !== null || focus !== null)) {
    const end = textNode.textContent?.length ?? 0;
    const clamp = (value) => Math.max(0, Math.min(value, end));
    selection.setBaseAndExtent(
      anchor !== null ? textNode : liveAnchorNode,
      anchor !== null ? clamp(anchor) : selection.anchorOffset,
      focus !== null ? textNode : liveFocusNode,
      focus !== null ? clamp(focus) : selection.focusOffset
    );
  }
  return span;
}
function deactivateSpan(span, onFlush) {
  const stash = stashes.get(span);
  const current = span.textContent ?? "";
  if (typeof onFlush === "function") onFlush();
  if (stash && current === stash.baseline && span.parentNode) {
    span.parentNode.replaceChild(stash.original, span);
  }
  stashes.delete(span);
}
function syncActiveInline(root, getSource, onFlush = null) {
  if (!root) return;
  const selection = root.ownerDocument.getSelection?.() ?? null;
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const endpoints = range ? [range.startContainer, range.endContainer] : [];
  const blocks = /* @__PURE__ */ new Map();
  for (const endpoint of endpoints) {
    const element = endpoint.nodeType === ELEMENT_NODE ? endpoint : endpoint.parentElement;
    const block = element?.closest?.("[data-editor-block-id]");
    if (!block || !root.contains(block) || blocks.has(block)) continue;
    const source = getSource?.(block) ?? null;
    if (source !== null) blocks.set(block, source);
  }
  for (const [block, source] of blocks) {
    const pairs = pairRevealables(source, block);
    if (!pairs) continue;
    for (const endpoint of endpoints) {
      if (!block.contains(endpoint)) continue;
      const pair = touchedPair(pairs, block, endpoint);
      if (pair && !pair.activeSpan) activatePair(pair, source, selection);
    }
    if (range && !range.collapsed) {
      for (const pair of pairs) {
        if (pair.activeSpan) continue;
        if (intersects(pair.element, range)) activatePair(pair, source, selection);
      }
    }
  }
  const liveRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const actives = [...root.querySelectorAll(ACTIVE_SELECTOR)];
  for (const span of actives) {
    if (liveRange && (span.contains(liveRange.startContainer) || span.contains(liveRange.endContainer))) continue;
    if (liveRange && !liveRange.collapsed && intersects(span, liveRange)) continue;
    deactivateSpan(span, onFlush);
  }
}
function activeInlineMap(source, root) {
  if (!root) return /* @__PURE__ */ new Map();
  const pairs = pairRevealables(source, root);
  if (!pairs) {
    return root.querySelector(ACTIVE_SELECTOR) ? null : /* @__PURE__ */ new Map();
  }
  const map = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    if (!pair.activeSpan) continue;
    map.set(pair.token.start, { span: pair.activeSpan, token: pair.token });
  }
  return map;
}
export {
  activeInlineMap,
  pairRevealables,
  syncActiveInline
};
