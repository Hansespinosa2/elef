import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["canvas", "edges", "nodes", "node"]

  connect() {
    this.scale = 1
    this.offset = { x: 0, y: 0 }
    this.drag = null
    this.layout()
    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(this.canvasTarget)
    this.boundPointerMove = (event) => this.pointerMove(event)
    this.boundPointerUp = () => this.pointerUp()
    window.addEventListener("pointermove", this.boundPointerMove)
    window.addEventListener("pointerup", this.boundPointerUp)
  }

  disconnect() {
    this.resizeObserver?.disconnect()
    window.removeEventListener("pointermove", this.boundPointerMove)
    window.removeEventListener("pointerup", this.boundPointerUp)
  }

  layout() {
    const nodes = this.nodeTargets
    if (!nodes.length) return
    const positions = this.positions(nodes)
    nodes.forEach((node) => {
      const point = positions.get(node.dataset.lineageGraphId)
      node.style.left = point.x + "px"
      node.style.top = point.y + "px"
    })
    this.drawEdges(nodes, positions)
    this.applyTransform()
  }

  positions(nodes) {
    const width = Math.max(this.canvasTarget.clientWidth, 760)
    const height = Math.max(this.canvasTarget.clientHeight, 520)
    const gap = 210
    const columns = Math.max(3, Math.floor((width - 80) / gap))
    const children = new Map(nodes.map((node) => [node.dataset.lineageGraphId, []]))
    nodes.forEach((node) => {
      if (node.dataset.lineageGraphParentId) children.get(node.dataset.lineageGraphParentId)?.push(node)
    })

    const roots = nodes.filter((node) => !node.dataset.lineageGraphParentId)
    const positions = new Map()
    let rootIndex = 0
    roots.forEach((root) => {
      const baseX = 90 + (rootIndex % 3) * gap
      const baseY = 100 + Math.floor(rootIndex / 3) * 250
      const queue = [{ node: root, depth: 0, branch: 0 }]
      while (queue.length) {
        const item = queue.shift()
        const x = Math.min(baseX + item.depth * gap, width - 190)
        const y = Math.min(baseY + item.branch * 145, height - 125)
        positions.set(item.node.dataset.lineageGraphId, { x, y })
        children.get(item.node.dataset.lineageGraphId)?.forEach((child, index) => {
          queue.push({ node: child, depth: item.depth + 1, branch: item.branch + index })
        })
      }
      rootIndex += 1
    })
    nodes.forEach((node, index) => positions.set(node.dataset.lineageGraphId, positions.get(node.dataset.lineageGraphId) || {
      x: 90 + (index % columns) * gap,
      y: 100 + Math.floor(index / columns) * 145
    }))
    return positions
  }

  drawEdges(nodes, positions) {
    const width = this.canvasTarget.clientWidth
    const height = this.canvasTarget.clientHeight
    this.edgesTarget.setAttribute("viewBox", "0 0 " + width + " " + height)
    this.edgesTarget.innerHTML = nodes.flatMap((node) => {
      const parentId = node.dataset.lineageGraphParentId
      const parent = nodes.find((candidate) => candidate.dataset.lineageGraphId === parentId)
      if (!parent) return []
      const from = positions.get(parentId)
      const to = positions.get(node.dataset.lineageGraphId)
      const x1 = from.x + 160
      const y1 = from.y + 45
      const x2 = to.x
      const y2 = to.y + 45
      const curve = Math.max(30, (x2 - x1) / 2)
      const type = node.dataset.lineageGraphType === "inspiration" ? "inspiration" : "continuation"
      return ['<path class="lineage-edge ' + type + '" d="M ' + x1 + " " + y1 + " C " + (x1 + curve) + " " + y1 + ", " + (x2 - curve) + " " + y2 + ", " + x2 + " " + y2 + '" />']
    }).join("")
  }

  pointerdown(event) {
    if (event.target.closest(".lineage-node")) return
    this.drag = { x: event.clientX, y: event.clientY, offset: { ...this.offset } }
  }

  pointerMove(event) {
    if (!this.drag) return
    this.offset.x = this.drag.offset.x + event.clientX - this.drag.x
    this.offset.y = this.drag.offset.y + event.clientY - this.drag.y
    this.applyTransform()
  }

  pointerUp() { this.drag = null }
  zoomIn() { this.scale = Math.min(1.8, this.scale + 0.1); this.applyTransform() }
  zoomOut() { this.scale = Math.max(0.6, this.scale - 0.1); this.applyTransform() }
  reset() { this.scale = 1; this.offset = { x: 0, y: 0 }; this.layout() }

  applyTransform() {
    const transform = "translate(" + this.offset.x + "px, " + this.offset.y + "px) scale(" + this.scale + ")"
    this.nodesTarget.style.transform = transform
    this.edgesTarget.style.transform = transform
  }
}
