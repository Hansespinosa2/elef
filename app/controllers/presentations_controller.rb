class PresentationsController < ApplicationController
  include WorkPreview

  before_action :set_presentation, only: %i[show edit update present publish destroy rename fork]
  before_action :set_preview_presentation, only: :preview

  def index
    @filter = "presentations"
    @works = Presentation.includes(:parent).recent_first
    @lineage_presentations = @works.select(&:presentation?)
    render "library/index"
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
    render layout: "presentation"
  end

  def publish
    @presentation.touch(:last_published_at)
    redirect_to present_presentation_path(@presentation)
  end

  def preview
    render_work_preview(@presentation || Presentation.new)
  end

  private

  def set_presentation
    @presentation = Presentation.find(params[:id])
  end

  def set_preview_presentation
    @presentation = Presentation.find(params[:id]) if params[:id].present?
  end

  def presentation_params
    params.require(:presentation).permit(:title, :source, :presentation_typography)
  end
end
