class Document < Work
  WORK_TYPE = "document".freeze
  DEFAULT_SOURCE = "# Untitled document\n\nStart writing Markdown here.".freeze

  default_scope { where(work_type: WORK_TYPE) }

  validates :title, uniqueness: { scope: :work_type }

  after_update :rewrite_incoming_document_links, if: :saved_change_to_title?

  def preview_html
    Presentations::DocumentRenderer.render(source, source_name: title, parsed: parsed_document)
  end

  private

  def rewrite_incoming_document_links
    old_title, new_title = saved_change_to_title
    DocumentLinks::Rewriter.rewrite!(old_title, new_title)
  end
end
