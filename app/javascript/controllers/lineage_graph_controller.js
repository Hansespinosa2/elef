import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["axis", "content", "edges", "node", "nodes", "viewport", "zoom"]

  connect() {
    this.scale = 1
    this.nodes = this.nodeTargets.map((element, index) => ({
      element,
      id: element.dataset.lineageGraphId,
      parentId: element.dataset.lineageGraphParentId,
      createdAt: new Date(element.dataset.lineageGraphCreatedAt),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      index
    }))
    this.links = this.nodes.filter((node) => node.parentId)
    this.layout()
    this.render()
  }

  disconnect() {
    this.nodes = []
  }

  layout() {
    const byDate = (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    const sorted = [...this.nodes].sort(byDate)
    const leftPadding = 110
    const nodeSpacing = 230
    const groupGap = 90
    const children = new Map(this.nodes.map((node) => [node.id, []]))
    this.links.forEach((child) => children.get(child.parentId)?.push(child))

    const roots = this.nodes.filter((node) => !node.parentId).sort(byDate)
    const laneByNode = new Map()
    let nextLane = 0
    const assignLanes = (node, lane) => {
      const descendants = children.get(node.id) || []
      if (descendants.length === 0) {
        laneByNode.set(node.id, lane)
        return lane + 1
      }

      const startLane = lane
      descendants.sort(byDate)
      descendants.forEach((child) => {
        lane = assignLanes(child, lane)
      })
      const childLanes = descendants.map((child) => laneByNode.get(child.id))
      laneByNode.set(node.id, Math.round((Math.min(...childLanes) + Math.max(...childLanes)) / 2))
      return Math.max(lane, startLane + 1)
    }
    roots.forEach((root) => {
      nextLane = assignLanes(root, nextLane)
      nextLane += 1
    })

    const dateGroups = []
    sorted.forEach((node) => {
      const dateKey = node.createdAt.toISOString().slice(0, 10)
      const group = dateGroups.find((candidate) => candidate.key === dateKey)
      if (group) {
        group.nodes.push(node)
      } else {
        dateGroups.push({ key: dateKey, nodes: [node] })
      }
    })

    let groupStart = leftPadding
    dateGroups.forEach((group) => {
      group.nodes.forEach((node, index) => {
        node.x = groupStart + index * nodeSpacing
        node.y = 105 + (laneByNode.get(node.id) || 0) * 135
      })
      group.tickX = groupStart + ((group.nodes.length - 1) * nodeSpacing) / 2
      groupStart += Math.max(nodeSpacing, group.nodes.length * nodeSpacing) + groupGap
    })
    this.width = Math.max(this.viewportTarget.clientWidth, groupStart + leftPadding)
    this.height = Math.max(470, 105 + Math.max(...this.nodes.map((node) => node.y), 0) + 100)
    this.contentTarget.style.width = `${this.width}px`
    this.contentTarget.style.height = `${this.height}px`
    this.zoomTarget.style.width = `${this.width * this.scale}px`
    this.zoomTarget.style.height = `${this.height * this.scale}px`
    this.axisTarget.innerHTML = dateGroups.map((group) => {
      const date = new Date(`${group.key}T00:00:00Z`)
      return `<span class="lineage-date-tick" style="left: ${group.tickX}px">${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>`
    }).join("")
  }

  render() {
    const positions = new Map(this.nodes.map((node) => [node.id, node]))
    this.nodes.forEach((node) => {
      node.element.style.left = (node.x - 88) + "px"
      node.element.style.top = (node.y - 50) + "px"
    })
    this.edgesTarget.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`)
    const paths = this.links.map((child) => {
      const parent = positions.get(child.parentId)
      if (!parent) return ""
      const start = this.edgePoint(parent, "right")
      const end = this.edgePoint(child, "left")
      const midX = start.x + (end.x - start.x) / 2
      const type = child.element.dataset.lineageGraphType === "inspiration" ? "inspiration" : "continuation"
      return `<path class="lineage-edge ${type}" data-lineage-edge-from="${parent.id}" data-lineage-edge-to="${child.id}" marker-end="url(#lineage-arrow)" d="M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}"/>`
    }).join("")
    this.edgesTarget.innerHTML = `<defs><marker id="lineage-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="#a995ff"></path></marker></defs>${paths}`
    this.applyScale()
  }

  edgePoint(node, side) {
    return { x: node.x + (side === "right" ? 88 : -88), y: node.y }
  }

  zoomIn() { this.scale = Math.min(1.8, this.scale + 0.1); this.applyScale() }
  zoomOut() { this.scale = Math.max(0.55, this.scale - 0.1); this.applyScale() }
  reset() { this.scale = 1; this.applyScale(); this.viewportTarget.scrollTo({ left: 0, top: 0 }) }
  applyScale() {
    this.zoomTarget.style.width = `${this.width * this.scale}px`
    this.zoomTarget.style.height = `${this.height * this.scale}px`
    this.contentTarget.style.transform = `scale(${this.scale})`
  }
}
