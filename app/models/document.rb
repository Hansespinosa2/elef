class Document < Work
  WORK_TYPE = "document".freeze
  DEFAULT_SOURCE = "# Untitled document".freeze

  before_validation :derive_title_from_source, if: -> { persisted? && will_save_change_to_source? }

  default_scope { where(kind: WORK_TYPE) }

  validates :title, uniqueness: { scope: [:workspace_id, :kind] }

  def preview_html
    preview_workspace = workspace || Workspace.default
    Presentations::DocumentRenderer.render(
      source,
      source_name: title,
      parsed: parsed_document,
      documents: Document.where(workspace: preview_workspace),
      workspace: preview_workspace
    )
  end

  def document_key
    document_detail&.document_key
  end

  def canonical_link
    document_detail&.canonical_link || "[[#{title}]]"
  end

  def aliases
    document_aliases.order(:created_at, :id)
  end

  def self.resolve_link(token, workspace: Workspace.default)
    token = token.to_s
    if (key = token[/\A(?:document|id):(.+)\z/, 1])
      joins(:document_detail).find_by(document_details: { document_key: key })
    else
      alias_record = DocumentAlias.find_by(workspace: workspace, alias_name: token)
      alias_record && find_by(id: alias_record.work_id)
    end
  end

  def outgoing_link_tokens
    DocumentLinks::Parser.parse(source)
  end

  def outgoing_documents
    outgoing_link_tokens.filter_map { |token| resolve_link_token(token) }.uniq
  end

  def unresolved_link_tokens
    outgoing_link_tokens.reject { |token| resolve_link_token(token) }
  end

  def incoming_backlinks
    candidates = self.class.where(workspace: workspace || Workspace.default).where.not(id: id).to_a
    candidates.select { |document| document.outgoing_documents.any? { |target| target.id == id } }
  end

  alias backlinks incoming_backlinks

  private

  def derive_title
    self.title = Presentations::Document.extract_first_h1(source.to_s).presence || default_title
  end

  def derive_title_from_source
    derive_title
  end

  def resolve_link_token(token)
    self.class.resolve_link(token.title.split("|", 2).first, workspace: workspace || Workspace.default)
  end
end
