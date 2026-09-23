import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["canvas", "viewport", "edges", "edge", "nodes", "node", "search", "results", "status", "scaleLabel"]
  static values = { data: Object }

  connect() {
    this.zoom = 1
    this.pan = { x: 0, y: 0 }
    this.drag = null
    this.alpha = 0.9
    this.boundHandlers = {
      resize: () => this.render(),
      pointerdown: (event) => this.startPan(event),
      pointermove: (event) => this.movePan(event),
      pointerup: () => this.stopPan(),
      pointercancel: () => this.stopPan(),
      wheel: (event) => this.wheel(event)
    }
    this.nodeHandlers = new Map()
    this.simulationFrame = requestAnimationFrame(() => this.simulate())
    this.render()

    this.nodeTargets.forEach((node) => {
      const handlers = {
        mouseenter: () => this.highlight(node.dataset.nodeId),
        focus: () => this.highlight(node.dataset.nodeId),
        mouseleave: () => this.highlight(),
        blur: () => this.highlight()
      }
      this.nodeHandlers.set(node, handlers)
      Object.entries(handlers).forEach(([event, handler]) => node.addEventListener(event, handler))
    })
    window.addEventListener("resize", this.boundHandlers.resize)
    this.canvasTarget.addEventListener("pointerdown", this.boundHandlers.pointerdown)
    this.canvasTarget.addEventListener("pointermove", this.boundHandlers.pointermove)
    this.canvasTarget.addEventListener("pointerup", this.boundHandlers.pointerup)
    this.canvasTarget.addEventListener("pointercancel", this.boundHandlers.pointercancel)
    this.canvasTarget.addEventListener("wheel", this.boundHandlers.wheel, { passive: false })
  }

  disconnect() {
    cancelAnimationFrame(this.simulationFrame)
    window.removeEventListener("resize", this.boundHandlers.resize)
    this.canvasTarget?.removeEventListener("pointerdown", this.boundHandlers.pointerdown)
    this.canvasTarget?.removeEventListener("pointermove", this.boundHandlers.pointermove)
    this.canvasTarget?.removeEventListener("pointerup", this.boundHandlers.pointerup)
    this.canvasTarget?.removeEventListener("pointercancel", this.boundHandlers.pointercancel)
    this.canvasTarget?.removeEventListener("wheel", this.boundHandlers.wheel)
    this.nodeHandlers?.forEach((handlers, node) => {
      Object.entries(handlers).forEach(([event, handler]) => node.removeEventListener(event, handler))
    })
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
    this.nodeStates()
    const canvasScale = Math.max(this.canvasTarget.clientWidth / 1000, 0.01)
    const labelSize = Math.max(15, 12 / canvasScale)
    this.nodeTargets.forEach((node) => {
      const state = this.nodeStateById.get(String(node.dataset.nodeId))
      if (state) {
        node.setAttribute("transform", `translate(${state.x} ${state.y})`)
        this.renderLabel(node, state, labelSize)
      }
    })
    this.edgeTargets.forEach((edge) => {
      const source = this.nodeStateById.get(String(edge.dataset.sourceId))
      const target = this.nodeStateById.get(String(edge.dataset.targetId))
      if (!source || !target) return
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(Math.hypot(dx, dy), 1)
      const unitX = dx / distance
      const unitY = dy / distance
      const nodeRadius = 18
      edge.setAttribute("x1", source.x + unitX * nodeRadius)
      edge.setAttribute("y1", source.y + unitY * nodeRadius)
      edge.setAttribute("x2", target.x - unitX * nodeRadius)
      edge.setAttribute("y2", target.y - unitY * nodeRadius)
    })
    this.viewportTarget.setAttribute("transform", `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`)
    if (this.hasScaleLabelTarget) this.scaleLabelTarget.textContent = `${Math.round(this.zoom * 100)}%`
  }

  renderLabel(node, state, labelSize) {
    const label = node.querySelector("text")
    if (!label) return

    const title = node.dataset.title || label.textContent
    const maxWidth = 250
    const maxCharacters = Math.max(10, Math.floor(maxWidth / (labelSize * 0.65)))
    const lines = this.wrapLabel(title, maxCharacters)
    const lineHeight = labelSize * 1.15
    const placeRight = state.x + 22 + maxWidth <= 980
    const x = placeRight ? 22 : -22
    const startY = state.y + lineHeight * lines.length > 600 ? -lineHeight * (lines.length - 1) + 5 : 5
    const layout = JSON.stringify({ title, labelSize, x, startY })
    if (node.dataset.labelLayout === layout) return

    label.replaceChildren()
    label.setAttribute("x", x)
    label.setAttribute("y", startY)
    label.setAttribute("text-anchor", placeRight ? "start" : "end")
    label.style.setProperty("font-size", `${labelSize}px`)
    lines.forEach((line, index) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan")
      tspan.textContent = line
      tspan.setAttribute("x", x)
      if (index > 0) tspan.setAttribute("dy", lineHeight)
      label.append(tspan)
    })

    const hitArea = node.querySelector(".document-graph-node-hit-area")
    const circle = node.querySelector("circle")
    if (hitArea && circle) {
      const labelBounds = label.getBBox()
      const circleBounds = circle.getBBox()
      const padding = 4
      const left = Math.min(labelBounds.x, circleBounds.x) - padding
      const top = Math.min(labelBounds.y, circleBounds.y) - padding
      const right = Math.max(labelBounds.x + labelBounds.width, circleBounds.x + circleBounds.width) + padding
      const bottom = Math.max(labelBounds.y + labelBounds.height, circleBounds.y + circleBounds.height) + padding
      hitArea.setAttribute("x", left)
      hitArea.setAttribute("y", top)
      hitArea.setAttribute("width", right - left)
      hitArea.setAttribute("height", bottom - top)
    }
    node.dataset.labelLayout = layout
  }

  wrapLabel(title, maxCharacters) {
    const words = title.split(/\s+/).filter(Boolean)
    const chunks = words.flatMap((word) => {
      const pieces = []
      for (let index = 0; index < word.length; index += maxCharacters) pieces.push(word.slice(index, index + maxCharacters))
      return pieces
    })
    const lines = []
    let line = ""
    chunks.forEach((chunk) => {
      const candidate = line ? `${line} ${chunk}` : chunk
      if (line && candidate.length > maxCharacters) {
        lines.push(line)
        line = chunk
      } else {
        line = candidate
      }
    })
    if (line) lines.push(line)
    return lines.length ? lines : [""]
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
    this.nodeTargets.forEach((node) => node.classList.remove("is-search-match"))
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
