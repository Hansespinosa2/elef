class Document < Work
  WORK_TYPE = "document".freeze
  DEFAULT_SOURCE = "# Untitled document\n\nStart writing Markdown here.".freeze

  default_scope { where(work_type: WORK_TYPE) }

  def preview_html
    Presentations::DocumentRenderer.render(source, source_name: title, parsed: parsed_document)
  end
end
