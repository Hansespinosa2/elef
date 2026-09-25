class DocumentsController < ApplicationController
  include WorkPreview
  include WorkPersistence

  before_action :set_document, only: %i[show edit update destroy rename restore history export]
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
    save_draft(@document, merge_draft_tokens(document_update_params))
  end

  def preview
    render_work_preview(@document || Document.new)
  end

  def rename
    title = params.require(:document).permit(:title)[:title]
    source = Presentations::Document.replace_first_h1(@document.source, title)
    if @document.update(source: source)
      redirect_to documents_path, notice: "Document renamed."
    else
      redirect_to documents_path, alert: @document.errors.full_messages.to_sentence
    end
  end

  def destroy
    @document.destroy!
    redirect_to documents_path, notice: "Document deleted."
  end

  def history
    render json: @document.work_revisions.history.map { |revision| revision_payload(revision) }
  end

  def restore
    revision = @document.work_revisions.find(params.require(:revision_id))
    result = DraftRestorer.call(@document, revision)
    payload = draft_payload(Drafts::Save::Result.new(:saved, result.work, result.revision, nil, [], nil))
    respond_to do |format|
      format.html { redirect_to edit_document_path(@document), notice: "Revision restored." }
      format.json { render json: payload, status: :ok }
    end
  end

  def export
    export_work(@document)
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
