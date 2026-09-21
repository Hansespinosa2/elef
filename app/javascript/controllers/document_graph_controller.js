import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["canvas", "viewport", "edges", "edge", "nodes", "node", "search", "results", "status", "scaleLabel"]
  static values = { data: Object }

  connect() {
    this.zoom = 1
    this.pan = { x: 0, y: 0 }
    this.drag = null
    this.alpha = 0.9
    this.simulationFrame = requestAnimationFrame(() => this.simulate())
    this.render()

    this.nodeTargets.forEach((node) => {
      node.addEventListener("mouseenter", () => this.highlight(node.dataset.nodeId))
      node.addEventListener("focus", () => this.highlight(node.dataset.nodeId))
      node.addEventListener("mouseleave", () => this.highlight())
      node.addEventListener("blur", () => this.highlight())
    })
    this.canvasTarget.addEventListener("pointerdown", (event) => this.startPan(event))
    this.canvasTarget.addEventListener("pointermove", (event) => this.movePan(event))
    this.canvasTarget.addEventListener("pointerup", () => this.stopPan())
    this.canvasTarget.addEventListener("pointercancel", () => this.stopPan())
    this.canvasTarget.addEventListener("wheel", (event) => this.wheel(event), { passive: false })
  }

  disconnect() {
    cancelAnimationFrame(this.simulationFrame)
    this.canvasTarget?.removeEventListener("pointerup", () => this.stopPan())
  }

  simulate() {
    if (this.alpha > 0.015) {
      this.applyForces()
      this.alpha *= 0.96
      this.render()
      this.simulationFrame = requestAnimationFrame(() => this.simulate())
    }
  }

  applyForces() {
    const nodes = this.nodeStates()
    nodes.forEach((node) => {
      node.vx = (node.vx || 0) * 0.82
      node.vy = (node.vy || 0) * 0.82
      node.vx += (500 - node.x) * 0.0008
      node.vy += (310 - node.y) * 0.0008
    })

    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const first = nodes[left]
        const second = nodes[right]
        const dx = second.x - first.x
        const dy = second.y - first.y
        const distance = Math.max(Math.hypot(dx, dy), 1)
        const force = 2600 / (distance * distance)
        const x = (dx / distance) * force
        const y = (dy / distance) * force
        first.vx -= x
        first.vy -= y
        second.vx += x
        second.vy += y
      }
    }

    this.dataValue.edges.forEach((edge) => {
      const source = this.nodeStateById.get(String(edge.source))
      const target = this.nodeStateById.get(String(edge.target))
      if (!source || !target) return
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(Math.hypot(dx, dy), 1)
      const force = (distance - 175) * 0.002
      source.vx += (dx / distance) * force
      source.vy += (dy / distance) * force
      target.vx -= (dx / distance) * force
      target.vy -= (dy / distance) * force
    })

    nodes.forEach((node) => {
      node.x = Math.max(35, Math.min(965, node.x + node.vx))
      node.y = Math.max(35, Math.min(585, node.y + node.vy))
    })
  }

  nodeStates() {
    if (!this.nodeStateById) {
      this.nodeStateById = new Map(this.dataValue.nodes.map((node) => [String(node.id), { ...node, vx: 0, vy: 0 }]))
    }
    return [...this.nodeStateById.values()]
  }

  render() {
    const states = this.nodeStates()
    this.nodeTargets.forEach((node) => {
      const state = this.nodeStateById.get(String(node.dataset.nodeId))
      if (state) node.setAttribute("transform", `translate(${state.x} ${state.y})`)
    })
    this.edgeTargets.forEach((edge) => {
      const source = this.nodeStateById.get(String(edge.dataset.sourceId))
      const target = this.nodeStateById.get(String(edge.dataset.targetId))
      if (!source || !target) return
      edge.setAttribute("x1", source.x)
      edge.setAttribute("y1", source.y)
      edge.setAttribute("x2", target.x)
      edge.setAttribute("y2", target.y)
    })
    this.viewportTarget.setAttribute("transform", `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`)
    if (this.hasScaleLabelTarget) this.scaleLabelTarget.textContent = `${Math.round(this.zoom * 100)}%`
  }

  search() {
    const query = this.searchTarget.value.trim().toLowerCase()
    this.resultsTarget.replaceChildren()
    if (!query) return this.closeSearch()

    const matches = this.dataValue.nodes.filter((node) => node.title.toLowerCase().includes(query)).slice(0, 8)
    matches.forEach((node) => {
      const result = document.createElement("button")
      result.type = "button"
      result.textContent = node.title
      result.addEventListener("click", () => {
        this.searchTarget.value = node.title
        this.centerNode(node.id)
        this.closeSearch()
      })
      this.resultsTarget.append(result)
    })
    this.resultsTarget.hidden = matches.length === 0
    this.statusTarget.textContent = `${matches.length} matching documents`
    this.nodeTargets.forEach((node) => node.classList.toggle("is-search-match", matches.some((match) => String(match.id) === node.dataset.nodeId)))
  }

  focusResult(event) {
    if (event.key !== "ArrowDown") return
    this.resultsTarget.querySelector("button")?.focus()
  }

  closeSearch() {
    this.resultsTarget.hidden = true
    this.statusTarget.textContent = ""
  }

  centerNode(id) {
    const state = this.nodeStateById.get(String(id))
    if (!state) return
    this.pan = { x: 500 - state.x * this.zoom, y: 310 - state.y * this.zoom }
    this.nodeTargets.find((node) => node.dataset.nodeId === String(id))?.focus()
    this.render()
  }

  highlight(id) {
    const related = new Set()
    if (id) {
      this.dataValue.edges.forEach((edge) => {
        if (String(edge.source) === String(id)) related.add(String(edge.target))
        if (String(edge.target) === String(id)) related.add(String(edge.source))
      })
    }
    this.nodeTargets.forEach((node) => {
      const active = id && (node.dataset.nodeId === String(id) || related.has(node.dataset.nodeId))
      node.classList.toggle("is-highlighted", Boolean(active))
      node.classList.toggle("is-dimmed", Boolean(id && !active))
    })
    this.edgeTargets.forEach((edge) => {
      const active = id && (edge.dataset.sourceId === String(id) || edge.dataset.targetId === String(id))
      edge.classList.toggle("is-highlighted", Boolean(active))
      edge.classList.toggle("is-dimmed", Boolean(id && !active))
    })
  }

  zoomIn() { this.setZoom(this.zoom * 1.2) }
  zoomOut() { this.setZoom(this.zoom / 1.2) }
  reset() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.render() }

  setZoom(value) {
    this.zoom = Math.max(0.55, Math.min(2.5, value))
    this.render()
  }

  startPan(event) {
    if (event.target.closest(".document-graph-node")) return
    this.drag = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y }
    this.canvasTarget.setPointerCapture(event.pointerId)
  }

  movePan(event) {
    if (!this.drag) return
    this.pan.x = this.drag.panX + event.clientX - this.drag.x
    this.pan.y = this.drag.panY + event.clientY - this.drag.y
    this.render()
  }

  stopPan() { this.drag = null }

  wheel(event) {
    event.preventDefault()
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.08 : 0.92))
  }
}
