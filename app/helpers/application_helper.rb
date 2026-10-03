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

  def shared_editor_projection(
    work,
    source: work.source.to_s,
    title: work.title
  )
    workspace = work.workspace || Workspace.default
    document_nodes = Document.where(workspace: workspace)
      .includes(:document_detail, :document_aliases)
      .order(:title)
      .map do |document|
        {
          id: document.id.to_s,
          title: document.title,
          documentKey: document.document_key,
          aliases: document.document_aliases
            .map(&:alias_name)
            .select { |name| DocumentLinks::Parser.linkable_title?(name) },
          href: document_path(document)
        }
      end
      .select { |node| DocumentLinks::Parser.linkable_title?(node[:title]) }

    margin_settings = if work.presentation?
      margin = work.document.margin_settings
      { section: margin.section, subsection: margin.subsection, footnote: margin.footnote, slide_count: margin.slide_count }
    else
      {}
    end

    Source::JavascriptRenderer.editor_preview(
      source,
      kind: work.document? ? "document" : "presentation",
      title: title,
      deck_id: work.id,
      media_resolver: WorkAssets.resolver_for(work),
      document_nodes: document_nodes,
      style: { theme: work.theme, typography: work.typography },
      margin_settings: margin_settings,
      allow_remote_media: true
    )
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
