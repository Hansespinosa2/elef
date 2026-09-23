class WorkSearch
  DEFAULT_LIMIT = 12
  MAX_LIMIT = 30

  def self.call(query, workspace: Workspace.default, limit: DEFAULT_LIMIT)
    new(query, workspace: workspace, limit: limit).call
  end

  def initialize(query, workspace:, limit:)
    @query = query.to_s.strip
    @workspace = workspace
    @limit = [[limit.to_i, 1].max, MAX_LIMIT].min
  end

  def call
    return [] if @query.blank?

    terms = @query.downcase.split(/\s+/)
    candidates = Work.where(workspace: @workspace).includes(:document_aliases).to_a
    candidates.filter_map do |work|
      score, matched_in, context = score_work(work, terms)
      next if score.zero?

      {
        id: work.id,
        type: work.work_type,
        type_label: work.document? ? "Document" : "Presentation",
        title: work.title,
        url: work.document? ? Rails.application.routes.url_helpers.document_path(work) : Rails.application.routes.url_helpers.presentation_path(work),
        score: score,
        matched_in: matched_in,
        context: context
      }
    end.sort_by { |result| [-result[:score], result[:title].downcase, -result[:id].to_i] }.first(@limit)
  end

  private

  def score_work(work, terms)
    fields = {
      title: work.title.to_s,
      aliases: work.document? ? work.document_aliases.map(&:alias_name).join(" ") : "",
      headings: work.source.to_s.lines.select { |line| line.match?(/\A\s{0,3}\#{1,6}\s+/) }.join,
      body: work.source.to_s
    }
    return [0, nil, nil] unless terms.all? { |term| fields.values.any? { |value| value.downcase.include?(term) } }

    matched_in = fields.keys.select { |field| terms.all? { |term| fields[field].downcase.include?(term) } }.first || :body
    weights = { title: 100, aliases: 85, headings: 65, body: work.presentation? ? 25 : 35 }
    score = fields.sum do |field, value|
      terms.sum { |term| value.downcase.include?(term) ? weights[field] : 0 }
    end
    [score, matched_in.to_s, context_for(fields[matched_in], terms.first)]
  end

  def context_for(text, term)
    text = text.to_s.gsub(/\s+/, " ").strip
    return text.first(180) if term.blank?

    position = text.downcase.index(term.downcase) || 0
    start = [[position - 70, 0].max, [text.length - 180, 0].max].min
    snippet = text[start, 180].to_s
    start.positive? ? "…#{snippet}" : snippet
  end
end
