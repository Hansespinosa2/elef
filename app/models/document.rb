class Document < Work
  WORK_TYPE = "document".freeze
  DEFAULT_SOURCE = "# Untitled document\n\nStart writing Markdown here.".freeze

  default_scope { where(work_type: WORK_TYPE) }
end
