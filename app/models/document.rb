class Document < Work
  WORK_TYPE = "document".freeze
  DEFAULT_SOURCE = "# Untitled document\n\nStart writing Markdown here.".freeze

  default_scope { where(kind: WORK_TYPE) }

  validates :title, uniqueness: { scope: [:workspace_id, :kind] }

  def preview_html
    Presentations::DocumentRenderer.render(
      source,
      source_name: title,
      parsed: parsed_document,
      documents: Document.all
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
end
