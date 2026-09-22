class DocumentsController < ApplicationController
  include WorkPreview

  before_action :set_document, only: %i[show edit update destroy rename]
  before_action :set_preview_document, only: :preview

  def index
    @filter = "documents"
    @works = Document.recent_first
    @lineage_presentations = []
    @document_graph = DocumentLinks::Graph.new(@works).as_json
    render "library/index"
  end

  def load_samples
    Documents::SampleData.load!
    redirect_to documents_path, notice: "Sample documents loaded."
  end

  def new
    @document = Document.new(source: Document::DEFAULT_SOURCE)
  end

  def start
    document = Document.create!(source: Document::DEFAULT_SOURCE)
    redirect_to edit_document_path(document), notice: "New document started."
  end

  def create
    @document = Document.new(document_params)
    if @document.save
      redirect_to edit_document_path(@document), notice: "Document saved."
    else
      render :new, status: :unprocessable_content
    end
  end

  def show
  end

  def edit
  end

  def update
    if @document.update(document_params)
      respond_to do |format|
        format.html { redirect_to edit_document_path(@document), notice: "Document saved." }
        format.json { render json: { id: @document.id, updated_at: @document.updated_at }, status: :ok }
      end
    else
      respond_to do |format|
        format.html { render :edit, status: :unprocessable_content }
        format.json { render json: { errors: @document.errors.full_messages }, status: :unprocessable_content }
      end
    end
  end

  def preview
    render_work_preview(@document || Document.new)
  end

  def rename
    if @document.update(title: params.require(:document).permit(:title)[:title])
      redirect_to documents_path, notice: "Document renamed."
    else
      redirect_to documents_path, alert: @document.errors.full_messages.to_sentence
    end
  end

  def destroy
    @document.destroy!
    redirect_to documents_path, notice: "Document deleted."
  end

  private

  def set_document
    @document = Document.find(params[:id])
  end

  def set_preview_document
    @document = Document.find(params[:id]) if params[:id].present?
  end

  def document_params
    params.require(:document).permit(:title, :source)
  end

end
