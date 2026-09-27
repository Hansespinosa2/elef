class BugReportsController < ApplicationController
  EXPECTED_MAX_LENGTH = 10_000
  ACTUAL_MAX_LENGTH = 10_000
  STEPS_MAX_LENGTH = 20_000

  def create
    submitted_report = params[:bug_report]
    submitted_report = ActionController::Parameters.new unless submitted_report.is_a?(ActionController::Parameters)
    report = submitted_report.permit(:expected, :actual, :steps).to_h.symbolize_keys
    errors = validation_errors(report)
    return render json: { error: errors.values.first, errors: errors }, status: :unprocessable_content if errors.any?

    renderer = BugReports::IssueRenderer.new
    title = renderer.title_for(actual: report[:actual])
    body = renderer.body(
      expected: report[:expected],
      actual: report[:actual],
      steps: report[:steps],
      environment: BugReports::Environment.new(user_agent: request.user_agent).to_s
    )
    result = BugReports::GithubIssueCreator.new.call(title: title, body: body)

    if result.success?
      render json: { url: result.url }
    else
      render json: { error: result.error }, status: :service_unavailable
    end
  end

  private

  def validation_errors(report)
    errors = {}
    errors[:expected] = "Add what you expected to happen." if report[:expected].blank?
    errors[:actual] = "Add what happened instead." if report[:actual].blank?
    usable_steps = report[:steps].to_s.lines.map { |line| line.strip.sub(/\A\d+[.)]\s*/, "") }.reject(&:blank?)
    errors[:steps] = "Add at least one reproduction step." if usable_steps.empty?
    errors[:expected] = "Expected behavior must be 10,000 characters or fewer." if report[:expected].to_s.length > EXPECTED_MAX_LENGTH
    errors[:actual] = "Actual behavior must be 10,000 characters or fewer." if report[:actual].to_s.length > ACTUAL_MAX_LENGTH
    errors[:steps] = "Steps to reproduce must be 20,000 characters or fewer." if report[:steps].to_s.length > STEPS_MAX_LENGTH
    errors
  end
end
