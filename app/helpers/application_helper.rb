module ApplicationHelper
  def work_type_label(work)
    work.document? ? "Document" : "Presentation"
  end

  def work_edit_path(work)
    work.document? ? edit_document_path(work) : edit_presentation_path(work)
  end

  def work_show_path(work)
    work.document? ? document_path(work) : presentation_path(work)
  end

  def work_preview_path(work)
    work.document? ? preview_document_path(work) : preview_presentation_path(work)
  end

  def work_preview_collection_path(work)
    work.document? ? preview_documents_path : preview_presentations_path
  end

  def work_rename_path(work)
    work.document? ? rename_document_path(work) : rename_presentation_path(work)
  end

  def work_delete_path(work)
    work.document? ? document_path(work) : presentation_path(work)
  end

  def work_new_path(work_type)
    work_type == "document" ? new_document_path : new_presentation_path
  end

  def work_start_path(work_type)
    work_type == "document" ? start_documents_path : start_presentations_path
  end

  def work_param_key(work)
    work.document? ? "document" : "presentation"
  end

  def pptx_library_path
    script_name = request.script_name.presence || Rails.application.config.relative_url_root
    "#{script_name.to_s.chomp("/")}/vendor/pptxgen.bundle.js"
  end

  def work_dom_id(work)
    "#{work.document? ? "document" : "presentation"}_#{work.id}"
  end

  def document_link_titles(workspace: Workspace.default)
    Document.where(workspace: workspace || Workspace.default).order(:title).pluck(:title).select do |title|
      DocumentLinks::Parser.linkable_title?(title)
    end
  end

  def snippet_category_label(category)
    category == "Elef DSL" ? "Elef directives" : category
  end

  def math_shortcut_example_input(shortcut)
    alias_name = shortcut.aliases.first
    shortcut.prefix == "." ? "x.#{alias_name}" : "@#{alias_name}"
  end

  def math_shortcut_example_expansion(shortcut)
    shortcut.expansion.to_s.gsub(MathShortcuts::Catalog::PLACEHOLDER, "x")
  end
end
