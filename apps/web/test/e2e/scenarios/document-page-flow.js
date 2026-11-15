// The same source and assertions run in the web browser and native WebKit.
export async function documentPageFlowWorkflow(ui) {
  await ui.openWork("E2E document")
  await ui.showSourceMode()
  const original = await ui.readSource()
  const paragraph = "Natural page flow continues this paragraph across pages. ".repeat(18).trim()
  const source = `Opening paragraph.\n\n${paragraph}\n\n${Array.from({ length: 10 }, (_, i) => `${i + 3}. Ordered item ${i + 3}`).join("\n")}`
  try {
    await ui.replaceSource(source)
    await ui.waitForSaved(source)
    await ui.waitForScrollPreview("Ordered item 12")
    const pages = await ui.pageFlowProbe(pageFlowProbe)
    const fragments = pages.flatMap(page => page.paragraphs.filter(text => text && paragraph.includes(text)))
    if (fragments.length < 2 || fragments.join("") !== paragraph || !pages[0].paragraphs.some(text => text.startsWith("Natural page flow"))) {
      throw new Error(`Paragraph did not flow into remaining space: ${JSON.stringify(pages)}`)
    }
    const lists = pages.flatMap(page => page.lists)
    let listNumber = 3
    for (const list of lists) {
      if (list.start !== listNumber) throw new Error(`Ordered list restarted: ${JSON.stringify(lists)}`)
      listNumber += list.items.length
    }
    if (lists.length < 2 || listNumber !== 13 || lists.flatMap(list => list.items).join(",") !== Array.from({ length: 10 }, (_, i) => `Ordered item ${i + 3}`).join(",")) {
      throw new Error(`List did not flow intact: ${JSON.stringify(lists)}`)
    }
  } finally {
    await ui.replaceSource(original)
    await ui.waitForSaved(original)
  }
}

// Serialized by each host's browser driver; keep it independent of module scope.
function pageFlowProbe(selector) {
  const surface = document.querySelector(selector)
  const controller = window.Stimulus.getControllerForElementAndIdentifier(surface.closest('[data-controller~="document-pages"]'), "document-pages")
  const style = document.createElement("style")
  style.textContent = `${selector} .document-page-content { flex: 0 0 220px !important; height: 220px !important; }`
  document.head.append(style)
  try {
    controller.paginate()
    return [...surface.querySelectorAll(".document-page-content")].map(content => ({
      paragraphs: [...content.querySelectorAll("p")].map(p => p.textContent),
      lists: [...content.querySelectorAll("ol")].map(ol => ({ start: ol.start, items: [...ol.children].map(li => li.textContent.trim()) }))
    }))
  } finally {
    style.remove()
    controller.paginate()
  }
}
