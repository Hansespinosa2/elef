const GITHUB_API_VERSION = "2026-03-10"

export async function cancelInProgressDesktopReleaseRuns({ owner, repository, token, apiUrl = "https://api.github.com", fetchImpl = fetch }) {
  if (![owner, repository, token].every(value => typeof value === "string" && value.length > 0)) {
    throw new TypeError("release cancellation needs repository identity and a token")
  }
  const baseUrl = apiUrl.replace(/\/$/, "")
  const workflowPath = ".github/workflows/desktop-release.yml"
  const url = `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/desktop-release.yml/runs?status=in_progress&per_page=100`
  const listed = await fetchImpl(url, { headers: headers(token) })
  if (!listed.ok) throw new Error(`could not list active desktop release runs (HTTP ${listed.status})`)
  const payload = await listed.json()
  if (!Array.isArray(payload.workflow_runs)) throw new Error("GitHub returned invalid desktop release run metadata")

  let cancelled = 0
  let alreadyFinished = 0
  for (const run of payload.workflow_runs) {
    if (run.path !== workflowPath || run.status !== "in_progress" || !Number.isInteger(run.id) || run.id < 1) continue
    const response = await fetchImpl(`${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/runs/${run.id}/cancel`, {
      method: "POST",
      headers: headers(token)
    })
    if (response.status === 202 || response.status === 200 || response.status === 204) {
      cancelled += 1
    } else if (response.status === 404 || response.status === 409) {
      alreadyFinished += 1
    } else {
      throw new Error(`could not cancel active desktop release run (HTTP ${response.status})`)
    }
  }
  return { cancelled, alreadyFinished }
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  }
}
