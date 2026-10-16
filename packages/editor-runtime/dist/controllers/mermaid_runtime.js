const MERMAID_CONTAINER_SELECTOR = "pre.mermaid";
const MERMAID_ERROR_CLASS = "mermaid-error";
const TRANSPARENT_BACKGROUNDS = ["transparent", "rgba(0, 0, 0, 0)"];
const DARK_LUMINANCE_THRESHOLD = 0.5;
let loading = null;
let renderSequence = 0;
function mermaidContainers(root) {
  return [...root.querySelectorAll(MERMAID_CONTAINER_SELECTOR)].filter((container) => !container.dataset.processed);
}
function nextMermaidRenderId(prefix = "elef-mermaid") {
  renderSequence += 1;
  return `${prefix}-${renderSequence}`;
}
function mermaidAssetUrl() {
  const importmap = document.querySelector('script[type="importmap"]');
  if (importmap) {
    try {
      const mappedUrl = JSON.parse(importmap.textContent).imports?.mermaid;
      if (mappedUrl) return mappedUrl;
    } catch {
    }
  }
  return document.querySelector('meta[name="elef-mermaid-url"]')?.content || null;
}
function loadMermaid() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const url = mermaidAssetUrl();
      if (!url) {
        reject(new Error("The Mermaid importmap pin is missing."));
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.addEventListener("load", () => {
        if (globalThis.mermaid) resolve(globalThis.mermaid);
        else reject(new Error("The Mermaid runtime did not load."));
      });
      script.addEventListener("error", () => reject(new Error(`The Mermaid runtime could not be fetched from ${url}.`)));
      document.head.appendChild(script);
    }).catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
function opaqueBackground(element) {
  let node = element instanceof Element && element.isConnected ? element : null;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const { backgroundColor } = window.getComputedStyle(node);
    if (backgroundColor && !TRANSPARENT_BACKGROUNDS.includes(backgroundColor) && !backgroundColor.endsWith(", 0)")) {
      return backgroundColor;
    }
    node = node.parentElement;
  }
  return window.getComputedStyle(document.body).backgroundColor || "rgb(17, 22, 26)";
}
function surfaceIsDark(element) {
  const channels = (opaqueBackground(element).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) return true;
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => channel / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < DARK_LUMINANCE_THRESHOLD;
}
function oradiaTheme(element) {
  const style = window.getComputedStyle(element instanceof Element && element.isConnected ? element : document.body);
  const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const fontFamily = token("--oradia-sans", "sans-serif");
  const shared = {
    fontFamily,
    darkMode: surfaceIsDark(element),
    background: token("--oradia-slate-950", "#11161a")
  };
  if (shared.darkMode) {
    return {
      ...shared,
      theme: "dark",
      surface: token("--oradia-slate-800", "#202c32"),
      surfaceAlt: token("--oradia-slate-900", "#182126"),
      ink: token("--oradia-ink", "#e9eee9"),
      muted: token("--oradia-muted", "#aab7b1"),
      accent: token("--oradia-green", "#9fc5a9"),
      line: token("--oradia-slate-700", "#304047")
    };
  }
  return {
    ...shared,
    theme: "base",
    surface: token("--oradia-paper-bright", "#fcfaf5"),
    surfaceAlt: token("--oradia-paper", "#f5f0e7"),
    ink: token("--oradia-paper-ink", "#252a27"),
    muted: token("--oradia-paper-muted", "#68716b"),
    accent: token("--oradia-green-deep", "#4f8b68"),
    line: token("--oradia-paper-line", "#d8d0c2")
  };
}
function mermaidConfig(element) {
  const theme = oradiaTheme(element);
  const { darkMode, surface, surfaceAlt, ink, muted, accent, line, background, fontFamily } = theme;
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: theme.theme,
    fontFamily,
    themeVariables: {
      background,
      darkMode,
      primaryColor: surface,
      primaryTextColor: ink,
      primaryBorderColor: line,
      secondaryColor: surfaceAlt,
      secondaryTextColor: ink,
      secondaryBorderColor: line,
      tertiaryColor: surfaceAlt,
      tertiaryTextColor: ink,
      tertiaryBorderColor: line,
      lineColor: line,
      textColor: ink,
      mainBkg: surface,
      secondBkg: surfaceAlt,
      nodeBorder: line,
      clusterBkg: surfaceAlt,
      clusterBorder: line,
      titleColor: accent,
      edgeLabelBackground: background,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: line,
      labelTextColor: ink,
      noteBkgColor: surfaceAlt,
      noteBorderColor: line,
      noteTextColor: ink,
      actorBkg: surface,
      actorBorder: line,
      actorTextColor: ink,
      actorLineColor: muted,
      signalColor: ink,
      signalTextColor: ink,
      pieTitleTextSize: "18px",
      pieTitleTextColor: ink,
      pieSectionTextColor: ink,
      sectionBkgColor: surfaceAlt,
      altSectionBkgColor: surface,
      taskBkgColor: surfaceAlt,
      taskBorderColor: line,
      taskTextColor: ink,
      gridColor: line,
      todayLineColor: accent
    }
  };
}
async function renderMermaidDiagrams(root) {
  const containers = mermaidContainers(root);
  if (!containers.length) return false;
  const sources = new Map(containers.map((container) => [container, container.innerHTML]));
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidConfig(root));
  await mermaid.run({ nodes: containers, suppressErrors: true });
  containers.forEach((container) => {
    if (container.querySelector("svg")) return;
    container.innerHTML = sources.get(container) ?? "";
    container.classList.add(MERMAID_ERROR_CLASS);
  });
  return true;
}
async function renderMermaidSvg(source, element) {
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidConfig(element));
  const { svg } = await mermaid.render(nextMermaidRenderId(), source);
  return svg;
}
export {
  MERMAID_CONTAINER_SELECTOR,
  MERMAID_ERROR_CLASS,
  loadMermaid,
  mermaidAssetUrl,
  mermaidConfig,
  mermaidContainers,
  nextMermaidRenderId,
  renderMermaidDiagrams,
  renderMermaidSvg
};
