class PresentationsController < ApplicationController
  before_action :set_presentation, only: %i[show edit update present]

  def index
    @presentations = Presentation.recent_first
  end

  def load_samples
    Presentations::SampleData.load!
    redirect_to presentations_path, notice: "Sample presentations loaded."
  end

  def show
  end

  def new
    @presentation = Presentation.new(source: Presentation::DEFAULT_SOURCE)
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
      redirect_to edit_presentation_path(@presentation), notice: "Presentation saved."
    else
      render :edit, status: :unprocessable_content
    end
  end

  def present
    render layout: "presentation"
  end

  private

  def set_presentation
    @presentation = Presentation.find(params[:id])
  end

  def presentation_params
    permitted = params.require(:presentation).permit(:title, :source, :presentation_typography)
    if permitted[:presentation_typography] == "book" && !source_declares_typography?(permitted[:source])
      permitted.delete(:presentation_typography)
    end
    permitted
  end

  def source_declares_typography?(source)
    Presentations::Document.front_matter_has_key?(source.to_s, "presentationTypography")
  end
end
