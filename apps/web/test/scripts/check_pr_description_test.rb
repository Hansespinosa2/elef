require "minitest/autorun"
require_relative "../../../../tooling/check_pr_description"

class CheckPrDescriptionTest < Minitest::Test
  VALID_BODY = <<~MARKDOWN
    ## Summary
    - Add revision-aware persistence.

    ## Why
    The editor needs recoverable drafts.

    ## What changed
    - `packages/local-store`: revision log; web host: restore banner.

    ## Screenshots
    None — no visual change (persistence-only).

    ## Validation
    - `bin/rails test`

    ## Adversarial reviews
    Round 1: PASS.

    ## Parity
    Shared package; web and desktop inherit. macOS unverified.

    ## Gaps
    None.

    ## Database / migration impact
    - Adds migrations and changes the default adapter.
  MARKDOWN

  def test_accepts_complete_description
    assert_empty PullRequestDescription.errors(VALID_BODY)
  end

  def test_requires_database_impact_section
    body = VALID_BODY.sub("## Database / migration impact\n- Adds migrations and changes the default adapter.\n", "")

    assert_includes PullRequestDescription.errors(body), "missing required section: ## Database / migration impact"
  end

  def test_requires_evidence_sections
    body = VALID_BODY.sub("## Screenshots\nNone — no visual change (persistence-only).\n\n", "")
      .sub("## Adversarial reviews\nRound 1: PASS.\n\n", "")
      .sub("## Parity\nShared package; web and desktop inherit. macOS unverified.\n\n", "")
      .sub("## Gaps\nNone.\n\n", "")
      .sub("## What changed\n- `packages/local-store`: revision log; web host: restore banner.\n\n", "")

    errors = PullRequestDescription.errors(body)
    assert_includes errors, "missing required section: ## What changed"
    assert_includes errors, "missing required section: ## Screenshots"
    assert_includes errors, "missing required section: ## Adversarial reviews"
    assert_includes errors, "missing required section: ## Parity"
    assert_includes errors, "missing required section: ## Gaps"
  end

  def test_rejects_current_merge_status
    body = VALID_BODY + "\nThis PR is intentionally opened for review and is not merged.\n"

    assert_includes PullRequestDescription.errors(body), "do not record current merge status in the description; GitHub is the source of truth"
  end
end
