class DocumentsController < ApplicationController
  before_action :set_document, only: %i[show edit update preview destroy rename]

  def index
    @filter = "documents"
    @works = Document.recent_first
    @presentations = @works
    @lineage_presentations = []
    render "presentations/index"
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
    render json: preview_payload(@document)
  rescue StandardError => error
    render json: {
      html: nil,
      warnings: ["Preview could not be rendered: #{error.message}. Check the latest Markdown edit."],
      revision: preview_revision
    }, status: :unprocessable_content
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

  def document_params
    params.require(:document).permit(:title, :source)
  end

  def preview_payload(work)
    attributes = params[:document].respond_to?(:permit) ? params[:document].permit(:title, :source) : {}
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

    {
      html: render_to_string(partial: "works/preview", formats: [:html], locals: { work: preview_work }),
      warnings: preview_work.preview_warnings,
      revision: preview_revision
    }
  end

  def preview_revision
    params[:revision].presence || @document.updated_at.to_i
  end
end
