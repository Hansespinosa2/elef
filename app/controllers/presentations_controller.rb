class PresentationsController < ApplicationController
  before_action :set_presentation, only: %i[show edit update present preview destroy rename fork]

  def index
    @filter = library_filter
    @works = case @filter
    when "documents" then Document.recent_first
    when "presentations" then Presentation.includes(:parent).recent_first
    else Work.includes(:parent).recent_first
    end
    @presentations = @works
    @lineage_presentations = @works.select(&:presentation?)
  end

  def load_samples
    Presentations::SampleData.load!
    Presentations::LineageSampleData.load!
    redirect_to presentations_path, notice: "Sample presentations loaded."
  end

  def show
  end

  def new
    @presentation = Presentation.new(source: Presentation::DEFAULT_SOURCE)
  end

  def start
    presentation = Presentation.create!(source: Presentation::DEFAULT_SOURCE)
    redirect_to edit_presentation_path(presentation), notice: "New presentation started."
  end

  def create
    @presentation = Presentation.new(presentation_params)
    if @presentation.save
      redirect_to edit_presentation_path(@presentation), notice: "Presentation saved."
    else
      render :new, status: :unprocessable_content
    end
  end

  def edit
  end

  def update
    if @presentation.update(presentation_params)
      respond_to do |format|
        format.html { redirect_to edit_presentation_path(@presentation), notice: "Presentation saved." }
        format.json { render json: { id: @presentation.id, updated_at: @presentation.updated_at }, status: :ok }
      end
    else
      respond_to do |format|
        format.html { render :edit, status: :unprocessable_content }
        format.json { render json: { errors: @presentation.errors.full_messages }, status: :unprocessable_content }
      end
    end
  end

  def rename
    if @presentation.update(title: params.require(:presentation).permit(:title)[:title])
      redirect_to presentations_path, notice: "Presentation renamed."
    else
      redirect_to presentations_path, alert: @presentation.errors.full_messages.to_sentence
    end
  end

  def destroy
    @presentation.destroy!
    redirect_to presentations_path, notice: "Presentation deleted."
  end

  def fork
    type = params.require(:fork_type)
    forked = @presentation.fork_as(type)

    if forked.save
      redirect_to edit_presentation_path(forked), notice: "Fork created as #{type}."
    else
      redirect_to presentations_path, alert: forked.errors.full_messages.to_sentence
    end
  rescue ArgumentError
    redirect_to presentations_path, alert: "Choose a valid fork type."
  end

  def present
    @presentation.touch(:last_published_at)
    render layout: "presentation"
  end

  def preview
    render json: preview_payload(@presentation)
  rescue StandardError => error
    render json: {
      html: nil,
      warnings: ["Preview could not be rendered: #{error.message}. Check the latest Markdown edit."],
      revision: preview_revision
    }, status: :unprocessable_content
  end

  private

  def set_presentation
    @presentation = Presentation.find(params[:id])
  end

  def library_filter
    value = params[:type].to_s
    %w[all documents presentations].include?(value) ? value : "presentations"
  end

  def preview_payload(work)
    attributes = params[:presentation].respond_to?(:permit) ? params[:presentation].permit(:title, :source, :presentation_typography) : {}
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
    typography = attributes[:presentation_typography].presence || params[:presentation_typography].presence
    preview_work.presentation_typography = typography if typography.present?

    {
      html: render_to_string(partial: "works/preview", formats: [:html], locals: { work: preview_work }),
      warnings: preview_work.preview_warnings,
      revision: preview_revision
    }
  end

  def preview_revision
    params[:revision].presence || @presentation.updated_at.to_i
  end

  def presentation_params
    params.require(:presentation).permit(:title, :source, :presentation_typography)
  end
end
