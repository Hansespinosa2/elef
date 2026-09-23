require "minitest/autorun"
require_relative "../../scripts/check_pr_description"

class CheckPrDescriptionTest < Minitest::Test
  VALID_BODY = <<~MARKDOWN
    ## Summary
    - Add revision-aware persistence.

    ## Why
    The editor needs recoverable drafts.

    ## Database / migration impact
    - Adds migrations and changes the default adapter.

    ## Validation
    - `bin/rails test`
  MARKDOWN

  def test_accepts_complete_description
    assert_empty PullRequestDescription.errors(VALID_BODY)
  end

  def test_requires_database_impact_section
    body = VALID_BODY.sub("## Database / migration impact\n- Adds migrations and changes the default adapter.\n\n", "")

    assert_includes PullRequestDescription.errors(body), "missing required section: ## Database / migration impact"
  end

  def test_rejects_current_merge_status
    body = VALID_BODY + "\nThis PR is intentionally opened for review and is not merged.\n"

    assert_includes PullRequestDescription.errors(body), "do not record current merge status in the description; GitHub is the source of truth"
  end
end
