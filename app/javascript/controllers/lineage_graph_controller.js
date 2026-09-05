import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["edges", "nodes", "node"]

  connect() {
    this.scale = 0.82
    this.offset = { x: 0, y: 0 }
    this.drag = null
    this.nodes = this.nodeTargets.map((element, index) => ({
      element,
      id: element.dataset.lineageGraphId,
      parentId: element.dataset.lineageGraphParentId,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      index
    }))
    this.links = this.nodes.filter((node) => node.parentId)
    this.seedPositions()
    this.render()
    this.startSimulation()
    this.boundPointerMove = (event) => this.pointerMove(event)
    this.boundPointerUp = () => this.pointerUp()
    window.addEventListener("pointermove", this.boundPointerMove)
    window.addEventListener("pointerup", this.boundPointerUp)
  }

  disconnect() {
    cancelAnimationFrame(this.animationFrame)
    window.removeEventListener("pointermove", this.boundPointerMove)
    window.removeEventListener("pointerup", this.boundPointerUp)
  }

  seedPositions() {
    const columns = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(this.nodes.length))))
    this.nodes.forEach((node, index) => {
      node.x = 100 + (index % columns) * 220
      node.y = 90 + Math.floor(index / columns) * 125
    })
  }

  startSimulation() {
    let ticks = 0
    const tick = () => {
      this.simulate()
      this.render()
      ticks += 1
      if (ticks < 300) this.animationFrame = requestAnimationFrame(tick)
    }
    this.animationFrame = requestAnimationFrame(tick)
  }

  simulate() {
    const centerX = this.canvasWidth() / 2
    const centerY = this.canvasHeight() / 2
    const repulsion = 3600
    this.nodes.forEach((node) => {
      if (node === this.drag?.node) return
      node.vx += (centerX - node.x) * 0.0007
      node.vy += (centerY - node.y) * 0.0007
    })
    for (let first = 0; first < this.nodes.length; first += 1) {
      for (let second = first + 1; second < this.nodes.length; second += 1) {
        const a = this.nodes[first]
        const b = this.nodes[second]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = repulsion / (distance * distance)
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force
        if (a !== this.drag?.node) { a.vx -= fx; a.vy -= fy }
        if (b !== this.drag?.node) { b.vx += fx; b.vy += fy }
        if (distance < 190) {
          const collision = (190 - distance) * 0.08
          const cx = (dx / distance) * collision
          const cy = (dy / distance) * collision
          if (a !== this.drag?.node) { a.vx -= cx; a.vy -= cy }
          if (b !== this.drag?.node) { b.vx += cx; b.vy += cy }
        }
      }
    }
    this.links.forEach((child) => {
      const parent = this.nodes.find((node) => node.id === child.parentId)
      if (!parent) return
      const dx = child.x - parent.x
      const dy = child.y - parent.y
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const force = (distance - 225) * 0.003
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      if (parent !== this.drag?.node) { parent.vx += fx; parent.vy += fy }
      if (child !== this.drag?.node) { child.vx -= fx; child.vy -= fy }
    })
    this.nodes.forEach((node) => {
      if (node === this.drag?.node) return
      node.vx *= 0.88
      node.vy *= 0.88
      node.x += node.vx
      node.y += node.vy
      node.x = Math.max(100, Math.min(this.canvasWidth() - 100, node.x))
      node.y = Math.max(75, Math.min(this.canvasHeight() - 75, node.y))
    })
  }

  render() {
    const positions = new Map(this.nodes.map((node) => [node.id, node]))
    this.nodes.forEach((node) => {
      node.element.style.left = (node.x - 88) + "px"
      node.element.style.top = (node.y - 50) + "px"
    })
    const width = this.canvasWidth()
    const height = this.canvasHeight()
    this.edgesTarget.setAttribute("viewBox", "0 0 " + width + " " + height)
    this.edgesTarget.innerHTML = this.links.map((child) => {
      const parent = positions.get(child.parentId)
      if (!parent) return ""
      const start = this.edgePoint(parent, child)
      const end = this.edgePoint(child, parent)
      const bend = Math.max(25, Math.abs(end.x - start.x) * 0.3)
      const direction = end.x >= start.x ? 1 : -1
      const type = child.element.dataset.lineageGraphType === "inspiration" ? "inspiration" : "continuation"
      return '<path class="lineage-edge ' + type + '" data-lineage-edge-from="' + parent.id + '" data-lineage-edge-to="' + child.id + '" d="M ' + start.x + " " + start.y + " C " + (start.x + bend * direction) + " " + start.y + ", " + (end.x - bend * direction) + " " + end.y + ", " + end.x + " " + end.y + '"/>'
    }).join("")
    this.applyTransform()
  }

  edgePoint(from, to) {
    const direction = to.x >= from.x ? 1 : -1
    return { x: from.x + direction * 88, y: from.y }
  }

  pointerdown(event) {
    const nodeElement = event.target.closest(".lineage-node")
    if (nodeElement) {
      event.preventDefault()
      const node = this.nodes.find((candidate) => candidate.element === nodeElement)
      this.drag = { node, moved: false }
      nodeElement.classList.add("is-dragging")
      return
    }
    this.drag = { startX: event.clientX, startY: event.clientY, offset: { ...this.offset }, moved: false }
  }

  pointerMove(event) {
    if (!this.drag) return
    if (this.drag.node) {
      const rect = this.element.getBoundingClientRect()
      this.drag.node.x = (event.clientX - rect.left - this.offset.x) / this.scale
      this.drag.node.y = (event.clientY - rect.top - this.offset.y) / this.scale
      this.drag.moved = true
      this.render()
      return
    }
    this.offset.x = this.drag.offset.x + event.clientX - this.drag.startX
    this.offset.y = this.drag.offset.y + event.clientY - this.drag.startY
    this.drag.moved = true
    this.applyTransform()
  }

  pointerUp() {
    if (this.drag?.node) {
      this.drag.node.element.classList.remove("is-dragging")
      if (this.drag.moved) this.drag.node.element.dataset.dragged = "true"
    }
    this.drag = null
  }

  zoomIn() { this.scale = Math.min(1.8, this.scale + 0.1); this.applyTransform() }
  zoomOut() { this.scale = Math.max(0.45, this.scale - 0.1); this.applyTransform() }
  reset() { this.scale = 0.82; this.offset = { x: 0, y: 0 }; this.seedPositions(); this.startSimulation() }
  canvasWidth() { return Math.max(this.element.clientWidth, 900) }
  canvasHeight() { return Math.max(this.element.clientHeight, 600) }
  applyTransform() {
    const transform = "translate(" + this.offset.x + "px, " + this.offset.y + "px) scale(" + this.scale + ")"
    this.nodesTarget.style.transform = transform
    this.edgesTarget.style.transform = transform
  }
}
