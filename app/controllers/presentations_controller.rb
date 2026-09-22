class PresentationsController < ApplicationController
  include WorkPreview
  include WorkPersistence

  before_action :set_presentation, only: %i[show edit update present publish destroy rename fork restore history export]
  before_action :set_preview_presentation, only: :preview

  def index
    @filter = "presentations"
    @works = Presentation.includes(:presentation_detail).recent_first
    @presentations = @works
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
    save_draft(@presentation, merge_draft_tokens(presentation_update_params))
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
    @published_work = @presentation
    @release = @presentation.published_release
    @presentation = @release&.presentation || @presentation
    @release_stale = @release&.stale?
    render layout: "presentation"
  end

  def publish
    result = PresentationReleasePublisher.call(@presentation)
    respond_to do |format|
      format.html { redirect_to present_presentation_path(@presentation), notice: "Presentation published." }
      format.json do
        render json: {
          release_id: result.release.id,
          source_revision_id: result.revision.id,
          source_digest: result.revision.source_digest,
          published_at: result.release.published_at.iso8601,
          status: "published"
        }, status: :ok
      end
    end
  end

  def preview
    render_work_preview(@presentation || Presentation.new)
  end

  def history
    render json: @presentation.work_revisions.history.map { |revision| revision_payload(revision) }
  end

  def restore
    revision = @presentation.work_revisions.find(params.require(:revision_id))
    result = DraftRestorer.call(@presentation, revision)
    payload = draft_payload(Drafts::Save::Result.new(:saved, result.work, result.revision, nil, [], nil))
    respond_to do |format|
      format.html { redirect_to edit_presentation_path(@presentation), notice: "Revision restored." }
      format.json { render json: payload, status: :ok }
    end
  end

  def export
    export_work(@presentation)
  end

  def import
    import_work(params[:package] || params[:file])
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

  def presentation_update_params
    params.require(:presentation).permit(
      :title, :source, :presentation_typography, :lock_version, :base_revision,
      :base_revision_id, :revision_token, :edit_session_id, :checkpoint, :reason
    )
  end
end
