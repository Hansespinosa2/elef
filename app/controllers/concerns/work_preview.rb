module WorkPreview
  extend ActiveSupport::Concern

  private

  def render_work_preview(work)
    render json: work_preview_payload(work)
  rescue StandardError => error
    Rails.logger.warn("Work preview failed (#{error.class}): #{error.message}")
    render json: {
      html: nil,
      editor_map: nil,
      warnings: ["Preview could not be rendered. Check the latest Markdown edit."],
      revision: work_preview_revision(work)
    }, status: :unprocessable_content
  end

  def work_preview_payload(work)
    attributes = work_preview_attributes(work)
    source = if attributes.key?(:source)
      attributes[:source]
    elsif params.key?(:source)
      params[:source]
    else
      work.source.to_s
    end
    raise ArgumentError, "Markdown source must be plain text" unless source.is_a?(String)

    title = if work.document?
      Source::Document.extract_first_h1(source).presence || work.title.presence || work.default_title
    else
      attributes[:title].presence || params[:title].presence || work.title
    end

    preview_work = work.class.new(title: title, source: source, work_type: work.work_type, workspace: work.workspace || Workspace.default)
    if work.persisted?
      preview_work.id = work.id
      preview_work.assets = work.assets.blobs if work.assets.attached?
    end
    preview_work.theme = attributes[:theme] if attributes.key?(:theme)
    preview_work.typography = attributes[:typography] if attributes.key?(:typography)

    html = if params[:projection].to_s == "editor"
      shared_preview = Source::EditorPreview.render(preview_work, source: source, title: title)
      editor_map = shared_preview.fetch(:editor_map)
      shared_preview.fetch(:html).html_safe
    else
      editor_map = Source::Document.editor_map(
        source.gsub(/\r\n?/, "\n"),
        source_name: title.presence || preview_work.default_title,
        mode: preview_work.work_type.to_sym
      )
      if preview_work.presentation?
        margin = preview_work.document.margin_settings
        settings = {
          "theme" => preview_work.theme,
          "typography" => preview_work.typography,
          "margin" => {
            "section" => margin.section,
            "subsection" => margin.subsection,
            "footnote" => margin.footnote,
            "slide_count" => margin.slide_count
          }
        }
        settings["asset_owner_id"] = work.id if work.persisted?
        asset_manifest = work.persisted? ? PresentationRelease.asset_manifest_for(work) : []
        Presentations::RenderCache.fetch(source: source, settings: settings, asset_manifest: asset_manifest) do
          render_to_string(
            partial: "works/preview",
            formats: [:html],
            locals: { work: preview_work, editable: false, editor_map: editor_map }
          )
        end
      else
        render_to_string(
          partial: "works/preview",
          formats: [:html],
          locals: { work: preview_work, editable: false, editor_map: editor_map }
        )
      end
    end

    {
      html: html,
      editor_map: editor_map,
      style: { theme: preview_work.theme_override, typography: preview_work.typography_override },
      warnings: preview_work.preview_warnings,
      revision: work_preview_revision(work)
    }
  end

  def work_preview_attributes(work)
    key = work.document? ? :document : :presentation
    fields = %i[title source theme typography]
    fields.delete(:title) if work.document?
    attributes = params[key]
    attributes.respond_to?(:permit) ? attributes.permit(*fields) : {}
  end

  def work_preview_revision(work)
    params[:revision].presence || work.updated_at&.to_i || work.lock_version.to_i
  end
end
