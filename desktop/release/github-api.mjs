const API_VERSION = "2026-03-10"

export const RELEASE_GATE_JOB_NAMES = Object.freeze([
  "desktop-fast",
  "scan_ruby",
  "scan_js",
  "test",
  "sqlite-test",
  "system-test",
  "desktop",
  "desktop-macos",
  "renderer-macos",
  "production-smoke",
  "development-smoke",
  "Exact main SHA release gate"
])

export class GitHubReleaseApi {
  constructor({ owner, repository, token, apiUrl = "https://api.github.com", fetchImpl = fetch, sleep = delay }) {
    if (!owner || !repository || !token) throw new TypeError("GitHub release API needs repository identity and a token")
    this.owner = owner
    this.repository = repository
    this.token = token
    this.apiUrl = apiUrl.replace(/\/$/, "")
    this.fetchImpl = fetchImpl
    this.sleep = sleep
  }

  async repositoryInfo() {
    return this.request("")
  }

  async pullRequestsForCommit(sha) {
    return this.paginate(`/commits/${encodeURIComponent(sha)}/pulls`)
  }

  async pullRequest(number) {
    return this.request(`/pulls/${number}`)
  }

  async pullRequestReviews(number) {
    return this.paginate(`/pulls/${number}/reviews`)
  }

  async mainWorkflowRuns(sha) {
    const query = new URLSearchParams({ head_sha: sha, event: "push", branch: "main", per_page: "100" })
    const response = await this.request(`/actions/workflows/ci.yml/runs?${query}`)
    return response.workflow_runs || []
  }

  async workflowJobs(runId) {
    const query = new URLSearchParams({ filter: "latest", per_page: "100" })
    const response = await this.request(`/actions/runs/${runId}/jobs?${query}`)
    return response.jobs || []
  }

  async versionTags() {
    const refs = await this.paginate("/git/matching-refs/tags/desktop-v")
    return refs.map(ref => ref.ref.replace("refs/tags/", ""))
  }

  async ownerApprovedPullRequest(pullRequest, ownerLogin) {
    if (pullRequest.base?.ref !== "main" || !pullRequest.merged_at || !pullRequest.merge_commit_sha) return false
    const reviews = await this.pullRequestReviews(pullRequest.number)
    const ownerReviews = reviews
      .filter(review => review.user?.login?.toLowerCase() === ownerLogin.toLowerCase() && review.submitted_at)
      .sort((left, right) => Date.parse(left.submitted_at) - Date.parse(right.submitted_at))
    const latestReview = ownerReviews.at(-1)
    return latestReview?.state === "APPROVED" && latestReview.commit_id === pullRequest.head?.sha
  }

  async gateForMainSha(sha) {
    const runs = (await this.mainWorkflowRuns(sha))
      .filter(run => run.head_sha === sha && run.event === "push" && run.head_branch === "main")
      .sort((left, right) => (right.run_attempt || 0) - (left.run_attempt || 0) || Date.parse(right.updated_at) - Date.parse(left.updated_at))
    const run = runs[0]
    if (!run || run.status !== "completed") return null
    const jobs = await this.workflowJobs(run.id)
    const byName = new Map(jobs.map(job => [job.name, job]))
    const required = RELEASE_GATE_JOB_NAMES.map(name => byName.get(name))
    if (required.some(job => !job)) return "failed_gate"
    if (required.some(job => job.status === "completed" && job.conclusion !== "success")) return "failed_gate"
    if (required.some(job => job.status !== "completed")) return null
    return "passed"
  }

  async paginate(resourcePath) {
    const results = []
    for (let page = 1; ; page += 1) {
      const separator = resourcePath.includes("?") ? "&" : "?"
      const query = new URLSearchParams({ per_page: "100", page: String(page) })
      const response = await this.request(`${resourcePath}${separator}${query}`)
      const pageItems = Array.isArray(response) ? response : response.items || []
      results.push(...pageItems)
      if (pageItems.length < 100) return results
    }
  }

  async request(resourcePath) {
    const endpoint = `${this.apiUrl}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}${resourcePath}`
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await this.fetchImpl(endpoint, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "X-GitHub-Api-Version": API_VERSION
          }
        })
        if (response.ok) return response.status === 204 ? null : await response.json()
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`GitHub API request failed with HTTP ${response.status}`)
        }
        const retryAfter = Number(response.headers?.get?.("retry-after"))
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1))
        lastError = new Error(`GitHub API temporarily returned HTTP ${response.status}`)
      } catch (error) {
        if (error?.message?.startsWith("GitHub API request failed with HTTP ")) throw error
        lastError = new Error("GitHub API request failed after a transient network error")
        await this.sleep(250 * (attempt + 1))
      }
    }
    throw lastError || new Error("GitHub API request failed")
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
