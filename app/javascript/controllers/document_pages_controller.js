import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["surface"]

  connect() {
    this.active = true
    this.blocks = [...this.surfaceTarget.children]
    this.frame = null
    this.boundResize = () => this.schedule()

    window.addEventListener("resize", this.boundResize)
    this.paginate()

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (this.active) this.schedule()
      })
    }
  }

  disconnect() {
    this.active = false
    window.removeEventListener("resize", this.boundResize)
    cancelAnimationFrame(this.frame)
  }

  schedule() {
    if (!this.active) return
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.paginate())
  }

  paginate() {
    if (!this.blocks) return

    this.surfaceTarget.replaceChildren()
    this.surfaceTarget.classList.add("is-paginated")

    const pages = []
    let currentPage = this.createPage(pages.length + 1)
    pages.push(currentPage)

    this.pageUnits().forEach((unit) => {
      const hadContent = currentPage.content.childElementCount > 0
      unit.forEach((block) => currentPage.content.append(block))

      if (!hadContent || !this.overflows(currentPage)) return

      unit.forEach((block) => currentPage.content.removeChild(block))
      currentPage = this.createPage(pages.length + 1)
      pages.push(currentPage)
      unit.forEach((block) => currentPage.content.append(block))

      if (this.overflows(currentPage)) currentPage.page.classList.add("is-overflowing")
    })

    pages.forEach(({ page, number }) => {
      page.setAttribute("aria-label", `Document page ${number} of ${pages.length}`)
      page.querySelector(".document-page-number").textContent = `Page ${number} of ${pages.length}`
    })
  }

  pageUnits() {
    const units = []

    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index]
      const unit = [block]

      if (this.isHeading(block) && this.blocks[index + 1]) {
        unit.push(this.blocks[index + 1])
        index += 1
      }

      units.push(unit)
    }

    return units
  }

  isHeading(block) {
    return /^H[1-6]$/.test(block.tagName)
  }

  createPage(number) {
    const page = document.createElement("article")
    page.className = "document-page"

    const content = document.createElement("div")
    content.className = "document-page-content"

    const footer = document.createElement("footer")
    footer.className = "document-page-footer"
    footer.setAttribute("aria-hidden", "true")

    const pageNumber = document.createElement("span")
    pageNumber.className = "document-page-number"
    pageNumber.textContent = `Page ${number}`
    footer.append(pageNumber)

    page.append(content, footer)
    this.surfaceTarget.append(page)
    return { content, number, page }
  }

  overflows({ content }) {
    return content.scrollHeight > content.clientHeight + 1
  }
}
