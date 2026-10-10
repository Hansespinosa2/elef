/** Create or reuse one owner-assigned issue per failed exact-SHA Gate A. */
export async function ensureGateFailureIssue({ repository, ownerLogin, token, sha, runUrl, detail, apiUrl = "https://api.github.com/", fetchImpl = globalThis.fetch }) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError("Gate A notification needs an owner/repository name")
  }
  if (typeof ownerLogin !== "string" || !/^[A-Za-z0-9-]+$/.test(ownerLogin)) {
    throw new TypeError("Gate A notification needs a repository owner login")
  }
  if (typeof token !== "string" || !token) throw new Error("Gate A notification needs issue write access")
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new TypeError("Gate A notification needs an exact main SHA")
  if (typeof fetchImpl !== "function") throw new TypeError("Gate A notification needs fetch")

  const baseUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28"
  }
  const title = `Elef Desktop Gate A failure: ${sha}`
  const query = new URL("search/issues", baseUrl)
  query.searchParams.set("q", `repo:${repository} is:issue in:title "${title}"`)
  const search = await requestJson(query, headers, fetchImpl)
  if (!Array.isArray(search.items)) throw new Error("GitHub returned invalid Gate A notification search results")

  const existing = search.items.find(item => !item.pull_request && item.title === title)
  if (existing) {
    if (!Number.isSafeInteger(existing.number) || existing.number < 1) throw new Error("GitHub returned an invalid Gate A alert issue")
    const hasOwner = Array.isArray(existing.assignees) && existing.assignees.some(user => user?.login?.toLowerCase() === ownerLogin.toLowerCase())
    if (existing.state !== "open" || !hasOwner) {
      const updated = await requestJson(new URL(`repos/${repository}/issues/${existing.number}`, baseUrl), headers, fetchImpl, {
        method: "PATCH",
        body: JSON.stringify({ state: "open", assignees: [ownerLogin] })
      })
      assertOwnerAssignedIssue(updated, title, ownerLogin)
      return { number: updated.number, url: updated.html_url, created: false }
    }
    return { number: existing.number, url: existing.html_url, created: false }
  }

  const created = await requestJson(new URL(`repos/${repository}/issues`, baseUrl), headers, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      title,
      assignees: [ownerLogin],
      body: issueBody({ ownerLogin, repository, sha, runUrl, detail })
    })
  })
  assertOwnerAssignedIssue(created, title, ownerLogin)
  if (typeof created.html_url !== "string") throw new Error("GitHub did not return the created Gate A alert URL")
  return { number: created.number, url: created.html_url, created: true }
}

export function gateFailureIssueTitle(sha) {
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new TypeError("Gate A alert title needs an exact main SHA")
  return `Elef Desktop Gate A failure: ${sha}`
}

function issueBody({ ownerLogin, repository, sha, runUrl, detail }) {
  const parsedRunUrl = new URL(runUrl)
  if (parsedRunUrl.protocol !== "https:") throw new TypeError("Gate A notification run URL must use HTTPS")
  const safeDetail = typeof detail === "string" ? detail : "Gate A failed for this exact main commit. No release artifact is eligible."
  return [
    `@${ownerLogin} The exact-SHA desktop release gate failed for \`${sha}\`.`,
    "",
    safeDetail,
    "",
    `Repository: ${repository}`,
    `Workflow run: ${runUrl}`,
    "",
    "Repair requires a new owner-approved PR. This alert does not authorize publication."
  ].join("\n")
}

function assertOwnerAssignedIssue(issue, title, ownerLogin) {
  if (!issue || issue.title !== title || !Number.isSafeInteger(issue.number) || issue.number < 1 || issue.state !== "open") {
    throw new Error("GitHub did not confirm an open Gate A alert issue")
  }
  if (!Array.isArray(issue.assignees) || !issue.assignees.some(user => user?.login?.toLowerCase() === ownerLogin.toLowerCase())) {
    throw new Error("GitHub did not confirm assignment of the Gate A alert to the repository owner")
  }
}

async function requestJson(url, headers, fetchImpl, options = {}) {
  let response
  try {
    response = await fetchImpl(url, { headers, ...options })
  } catch {
    throw new Error("could not create or verify the owner-assigned Gate A alert")
  }
  if (!response.ok) throw new Error(`could not create or verify the owner-assigned Gate A alert (HTTP ${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error("GitHub returned invalid Gate A alert data")
  }
}
