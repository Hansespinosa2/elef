class DocumentsController < ApplicationController
  include WorkPreview
  include WorkPersistence

  before_action :set_document, only: %i[show edit update destroy rename restore history export print upload_asset media_asset]
  before_action :set_preview_document, only: :preview

  def index
    @filter = "documents"
    @works = Document.recent_first
    @lineage_presentations = []
    @document_graph = DocumentLinks::Graph.new(@works).as_json
    render "library/index"
  end

  def load_samples
    result = Documents::SampleData.load!
    flash_options = {}
    flash_options[:notice] = "Sample documents loaded." if result.records.any?
    flash_options[:alert] = sample_conflict_alert(result.conflicts) if result.conflicts.any?

    redirect_to documents_path, **flash_options
  end

  def new
    @document = Document.new(source: Document.available_default_source)
  end

  def start
    document = Document.create!(source: Document.available_default_source)
    redirect_to edit_document_path(document), notice: "New document started."
  end

  def create
    @document = Document.new(document_params)
    respond_to do |format|
      if @document.save
        format.html { redirect_to edit_document_path(@document, editor_mode: submitted_editor_mode), notice: "Document saved." }
        format.json do
          render json: {
            id: @document.id,
            edit_url: edit_document_path(@document, editor_mode: submitted_editor_mode),
            upload_url: upload_asset_document_path(@document),
            lock_version: @document.lock_version,
            revision_token: @document.revision_token
          }, status: :created
        end
      else
        format.html { render :new, status: :unprocessable_content }
        format.json { render json: { errors: @document.errors.full_messages }, status: :unprocessable_content }
      end
    end
  end

  def show
  end

  def print
    render layout: "presentation"
  end

  def edit
  end

  def update
    save_draft(@document, merge_draft_tokens(document_update_params))
  end

  def preview
    render_work_preview(@document || Document.new)
  end

  def rename
    title = params.require(:document).permit(:title)[:title]
    source = Source::Document.replace_first_h1(@document.source, title)
    if @document.update(source: source)
      redirect_to(params[:library_view] == "all" ? root_path : documents_path, notice: "Document renamed.")
    else
      redirect_to(params[:library_view] == "all" ? root_path : documents_path, alert: @document.errors.full_messages.to_sentence)
    end
  end

  def destroy
    @document.destroy!
    redirect_to documents_path, notice: "Document deleted."
  end

  def history
    render_work_history(@document)
  end

  def restore
    restore_work_revision(@document)
  end

  def export
    export_work(@document)
  end

  def upload_asset
    upload_work_asset(@document)
  end

  def media_asset
    send_work_media_asset(@document)
  end

  def import
    import_work(params[:package] || params[:file])
  end

  private

  def set_document
    @document = Document.find(params[:id])
  end

  def set_preview_document
    @document = Document.find(params[:id]) if params[:id].present?
  end

  def document_params
    params.require(:document).permit(:source, :theme, :typography)
  end

  def document_update_params
    params.require(:document).permit(
      :source, :lock_version, :base_revision, :base_revision_id,
      :revision_token, :edit_session_id, :checkpoint, :reason, :theme, :typography
    )
  end

  def sample_conflict_alert(conflicts)
    noun = conflicts.one? ? "document" : "documents"
    title_noun = conflicts.one? ? "title" : "titles"
    titles = conflicts.map { |conflict| %("#{conflict.title}") }.to_sentence
    "Skipped sample #{noun} with conflicting #{title_noun}: #{titles}."
  end
end
