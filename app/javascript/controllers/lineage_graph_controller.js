import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["axis", "content", "edges", "node", "viewport", "zoom", "search", "results", "date", "status"]

  connect() {
    this.scale = 1
    this.nodes = this.nodeTargets.map(element => ({
      element, id: element.dataset.lineageGraphId,
      parentId: element.dataset.lineageGraphParentId,
      title: element.dataset.lineageGraphTitle,
      date: element.dataset.lineageGraphCreatedAt.slice(0, 10),
      timestamp: Date.parse(element.dataset.lineageGraphCreatedAt),
      type: element.dataset.lineageGraphType
    })).sort((a, b) => a.timestamp - b.timestamp || Number(a.id) - Number(b.id))
    this.positions = new Map(this.nodes.map(node => [node.id, node]))
    this.layout()
    this.render()
    this.resizeObserver = new ResizeObserver(() => this.render())
    this.nodeTargets.forEach(node => this.resizeObserver.observe(node))
  }

  disconnect() { this.resizeObserver?.disconnect() }

  layout() {
    const children = new Map(this.nodes.map(node => [node.id, []]))
    this.nodes.forEach(node => children.get(node.parentId)?.push(node))
    let nextLane = 0
    const visited = new Set()
    const placeBranch = (root, lane) => {
      const pending = [{ node: root, lane }]
      while (pending.length) {
        const entry = pending.pop()
        const node = entry.node
        if (visited.has(node.id)) continue
        visited.add(node.id)
        node.lane = entry.lane ?? nextLane++
        const descendants = children.get(node.id)
        const main = descendants.find(child => child.type === "continuation") || descendants[0]
        descendants.filter(child => child !== main).reverse().forEach(child => pending.push({ node: child }))
        if (main) pending.push({ node: main, lane: node.lane })
      }
    }
    const roots = this.nodes.filter(node => !this.positions.has(node.parentId))
    roots.filter(root => children.get(root.id).length).forEach(root => {
      placeBranch(root, nextLane++)
      nextLane += 0.15
    })
    // Independent decks form a compact shelf beneath the connected families.
    const independent = roots.filter(root => !children.get(root.id).length)
    independent.forEach((root, index) => {
      root.lane = nextLane + Math.floor(index / 3)
      visited.add(root.id)
    })
    nextLane += Math.ceil(independent.length / 3)
    // Imported invalid relationships must not hide presentations.
    this.nodes.filter(node => !visited.has(node.id)).forEach(node => placeBranch(node, nextLane++))

    const groups = new Map()
    this.nodes.forEach(node => {
      if (!groups.has(node.date)) groups.set(node.date, [])
      groups.get(node.date).push(node)
    })
    this.groups = []
    let firstColumn = 0
    groups.forEach((nodes, date) => {
      const occupied = new Map()
      nodes.forEach(node => {
        const parent = this.positions.get(node.parentId)
        node.column = Math.max(firstColumn, (occupied.get(node.lane) ?? firstColumn - 1) + 1,
          parent?.column === undefined ? firstColumn : parent.column + 1)
        occupied.set(node.lane, node.column)
        node.element.style.left = `${40 + node.column * 292}px`
        node.element.style.top = `${84 + node.lane * 174}px`
      })
      const lastColumn = Math.max(...nodes.map(node => node.column))
      this.groups.push({ date, left: 20 + firstColumn * 292, width: (lastColumn - firstColumn + 1) * 292 })
      firstColumn = lastColumn + 1
    })
    this.width = 40 + firstColumn * 292
    this.height = Math.max(440, 84 + nextLane * 174 + 80)
    Object.assign(this.contentTarget.style, { width: `${this.width}px`, height: `${this.height}px` })
    this.axisTarget.replaceChildren()
    this.dateTarget.replaceChildren(new Option("Jump to date…", ""))
    this.groups.forEach(group => {
      const label = new Date(`${group.date}T00:00:00Z`).toLocaleDateString(undefined,
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      const band = document.createElement("span")
      band.className = "lineage-date-tick"
      band.textContent = label
      Object.assign(band.style, { left: `${group.left}px`, width: `${group.width}px` })
      this.axisTarget.append(band)
      this.dateTarget.add(new Option(label, group.date))
    })
  }

  render() {
    this.edgesTarget.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`)
    this.edgesTarget.setAttribute("width", this.width)
    this.edgesTarget.setAttribute("height", this.height)
    const paths = this.nodes.map(child => {
      const parent = this.positions.get(child.parentId)
      if (!parent) return ""
      const start = this.edgePoint(parent, "right")
      const end = this.edgePoint(child, "left")
      // Turn in the gutter after the parent, then follow the child's lane.
      const turn = start.x + 40
      const type = child.type === "inspiration" ? "inspiration" : "continuation"
      return `<path class="lineage-edge ${type}" data-lineage-edge-from="${parent.id}" data-lineage-edge-to="${child.id}" marker-end="url(#lineage-arrow-${type})" d="M ${start.x} ${start.y} H ${turn} V ${end.y} H ${end.x}"/>`
    }).join("")
    const markers = [["continuation", "#7964bd"], ["inspiration", "#b78543"]].map(([type, color]) =>
      `<marker id="lineage-arrow-${type}" markerWidth="7" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 7 4 L 0 8 z" fill="${color}"/></marker>`).join("")
    this.edgesTarget.innerHTML = `<defs>${markers}</defs>${paths}`
    this.applyScale()
  }

  edgePoint(node, side) {
    const element = node.element
    return { x: element.offsetLeft + (side === "right" ? element.offsetWidth : 0),
      y: element.offsetTop + element.offsetHeight / 2 }
  }

  search() {
    const query = this.searchTarget.value.trim().toLocaleLowerCase()
    this.resultsTarget.replaceChildren()
    this.resultsTarget.hidden = !query
    if (!query) return
    const matches = this.nodes.filter(node => node.title.toLocaleLowerCase().includes(query))
    matches.forEach(node => {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = `${node.title} · ${node.date}`
      button.addEventListener("click", () => this.locate(node))
      this.resultsTarget.append(button)
    })
    if (!matches.length) this.resultsTarget.textContent = "No matching presentations."
    this.statusTarget.textContent = `${matches.length} matching presentations`
  }

  locate(node) {
    this.resultsTarget.hidden = true
    this.scale = 1
    this.applyScale()
    this.viewportTarget.scrollTo({ left: Math.max(0, node.element.offsetLeft - this.viewportTarget.clientWidth / 2 + 104),
      top: Math.max(0, node.element.offsetTop - this.viewportTarget.clientHeight / 2 + 58.5) })
    this.nodeTargets.forEach(element => element.classList.toggle("is-located", element === node.element))
    node.element.focus({ preventScroll: true })
    this.statusTarget.textContent = node.title
  }

  jumpToDate() {
    const group = this.groups.find(group => group.date === this.dateTarget.value)
    if (group) this.viewportTarget.scrollTo({ left: group.left * this.scale, top: 0 })
  }

  zoomIn() { this.scale = Math.min(1.5, this.scale + 0.15); this.applyScale() }
  zoomOut() { this.scale = Math.max(0.4, this.scale - 0.15); this.applyScale() }
  fit() {
    this.scale = Math.min(1, (this.viewportTarget.clientWidth - 24) / this.width, (this.viewportTarget.clientHeight - 24) / this.height)
    this.applyScale()
    this.viewportTarget.scrollTo({ left: 0, top: 0 })
  }
  reset() { this.scale = 1; this.applyScale(); this.viewportTarget.scrollTo({ left: 0, top: 0 }) }
  applyScale() {
    this.zoomTarget.style.width = `${this.width * this.scale}px`
    this.zoomTarget.style.height = `${this.height * this.scale}px`
    this.contentTarget.style.transform = `scale(${this.scale})`
  }
}
