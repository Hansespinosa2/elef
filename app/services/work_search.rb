class WorkSearch
  DEFAULT_LIMIT = 12
  MAX_LIMIT = 30
  WORK_TYPES = {
    "document" => "document",
    "documents" => "document",
    "presentation" => "presentation",
    "presentations" => "presentation"
  }.freeze

  def self.call(query, workspace: Workspace.default, limit: DEFAULT_LIMIT, type: nil)
    new(query, workspace: workspace, limit: limit, type: type).call
  end

  def initialize(query, workspace:, limit:, type:)
    @query = query.to_s.strip
    @workspace = workspace
    @limit = [[limit.to_i, 1].max, MAX_LIMIT].min
    @work_type = WORK_TYPES[type.to_s.downcase]
  end

  def call
    return [] if @query.blank?

    clauses = query_clauses
    return [] if clauses.empty?

    candidates = Work.where(workspace: @workspace)
    candidates = candidates.where(kind: @work_type) if @work_type
    candidates = candidates.includes(:document_aliases).to_a

    candidates.filter_map do |work|
      score, matched_in, context = score_work(work, clauses)
      next if score.zero?

      result = {
        id: work.id,
        type: work.work_type,
        type_label: work.document? ? "Document" : "Presentation",
        title: work.title,
        url: work.document? ? Rails.application.routes.url_helpers.document_path(work) : Rails.application.routes.url_helpers.presentation_path(work),
        updated_at: work.updated_at.iso8601,
        score: score,
        matched_in: matched_in,
        context: context
      }
      [score, work.updated_at.to_f, result]
    end.sort_by { |score, updated_at, result| [-score, -updated_at, result[:title].downcase, -result[:id].to_i] }.first(@limit).map(&:last)
  end

  private

  def query_clauses
    @query.scan(/"([^"]+)"|(\S+)/).filter_map do |phrase, word|
      clause = normalize(phrase.presence || word)
      clause.presence
    end
  end

  def score_work(work, clauses)
    fields = {
      title: work.title.to_s,
      aliases: work.document? ? work.document_aliases.map(&:alias_name).join(" ") : "",
      headings: work.source.to_s.lines.select { |line| line.match?(/\A\s{0,3}\#{1,6}\s+/) }.join,
      content: work.source.to_s
    }
    normalized_fields = fields.transform_values { |value| normalize(value) }

    field_matches = clauses.map do |clause|
      fields.keys.find { |field| normalized_fields[field].include?(clause) }
    end
    return [0, nil, nil] if field_matches.any?(&:nil?)

    weights = { title: 120, aliases: 100, headings: 75, content: 40 }
    score = field_matches.sum { |field| weights.fetch(field) }
    matched_field = field_matches.tally.max_by { |field, count| [count, weights.fetch(field)] }.first
    matched_in = { aliases: "alias", headings: "heading", content: "content" }.fetch(matched_field, "title")
    context_clause = clauses.find { |clause| normalized_fields[matched_field].include?(clause) } || clauses.first

    [score, matched_in, context_for(fields[matched_field], context_clause)]
  end

  def normalize(text)
    text.to_s.unicode_normalize(:nfkd).gsub(/\p{Mn}/, "").downcase.gsub(/\s+/, " ")
  end

  def context_for(text, clause)
    text = text.to_s.gsub(/\s+/, " ").strip
    return text.first(180) if clause.blank?

    position = normalize(text).index(clause) || 0
    start = [[position - 70, 0].max, [text.length - 180, 0].max].min
    snippet = text[start, 180].to_s
    prefix = start.positive? ? "…" : ""
    suffix = start + snippet.length < text.length ? "…" : ""
    "#{prefix}#{snippet}#{suffix}"
  end
end
