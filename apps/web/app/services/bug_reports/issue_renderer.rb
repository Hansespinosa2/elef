module BugReports
  class IssueRenderer
    FOOTER = "Fix this bug, ensure it passes all tests (skip only checks failing due to CI rate/API limits),"
    TITLE_LIMIT = 100

    def self.title_for(actual:)
      new.title_for(actual: actual)
    end

    def title_for(actual:)
      first_line = actual.to_s.lines.map(&:strip).find(&:present?)
      return "Bug report" unless first_line

      title = "Bug: #{first_line.gsub(/\s+/, " ")}"
      return title if title.length <= TITLE_LIMIT

      "#{title.first(TITLE_LIMIT - 1)}…"
    end

    def body(expected:, actual:, steps:, environment:)
      step_lines = normalize_steps(steps)

      [
        "## Bug Report",
        "",
        "**Expected:** #{markdown_multiline(expected)}",
        "",
        "**Actual:** #{markdown_multiline(actual)}",
        "",
        "**Steps to reproduce:**",
        "",
        *step_lines.each_with_index.map { |step, index| "#{index + 1}. #{markdown_text(step)}" },
        "",
        "**Environment:** #{markdown_text(environment)}",
        "",
        "---",
        "",
        FOOTER
      ].join("\n")
    end

    private

    def normalize_steps(steps)
      steps.to_s.gsub(/\r\n?/, "\n").split("\n").filter_map do |line|
        step = line.strip.sub(/\A\d+[.)]\s*/, "")
        step.presence
      end
    end

    def markdown_multiline(value)
      value.to_s.gsub(/\r\n?/, "\n").split("\n", -1).map { |line| markdown_text(line) }.join("<br>\n")
    end

    def markdown_text(value)
      escaped = value.to_s
        .gsub("&", "&amp;")
        .gsub("<", "&lt;")
        .gsub(">", "&gt;")
      escaped.gsub(/([\\`*_{}\[\]()#+.!|~-])/) { |character| "\\#{character}" }
    end
  end
end
