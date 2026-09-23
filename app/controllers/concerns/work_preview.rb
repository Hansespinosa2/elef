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
    title = attributes[:title].presence || params[:title].presence || work.title
    raise ArgumentError, "Markdown source must be plain text" unless source.is_a?(String)

    preview_work = work.class.new(title: title, source: source, work_type: work.work_type)
    if work.presentation?
      typography = attributes[:presentation_typography].presence || params[:presentation_typography].presence
      preview_work.presentation_typography = typography if typography.present?
    end

    editor_map = Presentations::Document.editor_map(
      source.gsub(/\r\n?/, "\n"),
      source_name: title.presence || preview_work.default_title,
      mode: preview_work.work_type.to_sym
    )

    html = if preview_work.presentation?
      margin = preview_work.document.margin_settings
      settings = {
        "theme" => preview_work.presentation_theme,
        "typography" => preview_work.presentation_typography,
        "margin" => {
          "section" => margin.section,
          "subsection" => margin.subsection,
          "footnote" => margin.footnote,
          "slide_count" => margin.slide_count
        }
      }
      if params[:projection].to_s == "editor"
        render_to_string(
          partial: "works/preview",
          formats: [:html],
          locals: { work: preview_work, editable: true, editor_map: editor_map }
        )
      else
        Presentations::RenderCache.fetch(source: source, settings: settings, asset_manifest: []) do
          render_to_string(
            partial: "works/preview",
            formats: [:html],
            locals: { work: preview_work, editable: false, editor_map: editor_map }
          )
        end
      end
    else
      render_to_string(
        partial: "works/preview",
        formats: [:html],
        locals: { work: preview_work, editable: params[:projection].to_s == "editor", editor_map: editor_map }
      )
    end

    {
      html: html,
      editor_map: editor_map,
      warnings: preview_work.preview_warnings,
      revision: work_preview_revision(work)
    }
  end

  def work_preview_attributes(work)
    key = work.document? ? :document : :presentation
    fields = work.document? ? %i[title source] : %i[title source presentation_typography]
    attributes = params[key]
    attributes.respond_to?(:permit) ? attributes.permit(*fields) : {}
  end

  def work_preview_revision(work)
    params[:revision].presence || work.updated_at&.to_i || work.lock_version.to_i
  end
end
