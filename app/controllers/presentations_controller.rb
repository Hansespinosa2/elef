class PresentationsController < ApplicationController
  include WorkPreview
  include WorkPersistence

  before_action :set_presentation, only: %i[show edit update present print pptx pptx_asset publish destroy rename fork restore history export upload_asset media_asset]
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

  def print
    @release = @presentation.published_release if params[:version] == "published"
    @presentation = @release&.presentation || @presentation
    render layout: "presentation"
  end

  def pptx
    version = params[:version].presence || "draft"
    return render json: { error: "Choose draft or published for the PPTX export." }, status: :bad_request unless %w[draft published].include?(version)

    presentation = @presentation
    release_id = nil
    if version == "published"
      release = @presentation.published_release
      return head :not_found unless release
      release_id = release.id

      presentation = release.presentation
      release_settings = release.settings || {}
      pinned_theme = release_settings["theme"] || release_settings[:theme]
      pinned_typography = release_settings["typography"] || release_settings[:typography]
      presentation.theme = pinned_theme if pinned_theme.present?
      presentation.typography = pinned_typography if pinned_typography.present?
      manifest = Array(release.asset_manifest)
      presentation.assets = manifest.filter_map do |asset|
        blob = ActiveStorage::Blob.find_by(id: asset["id"] || asset[:id])
        blob if blob && blob.key == (asset["key"] || asset[:key])
      end
    end

    response.headers["Cache-Control"] = "private, no-store"
    render json: Presentations::PptxExport.new(presentation, version:, release_id:).as_json
  rescue Presentations::PptxExport::Error => error
    render json: { error: error.message }, status: :unprocessable_content
  end

  def pptx_asset
    return head :not_found unless params[:digest].to_s.match?(/\A[0-9a-f]{64}\z/)

    version = params[:version].presence || "draft"
    return head :not_found unless %w[draft published].include?(version)

    blob = if version == "published"
      release = if params[:release_id].present?
        PresentationRelease.find_by(id: params[:release_id], work: @presentation)
      else
        @presentation.published_release
      end
      return head :not_found unless release

      manifest_asset = Array(release.asset_manifest).find do |asset|
        blob_id = asset["id"] || asset[:id]
        candidate = ActiveStorage::Blob.find_by(id: blob_id) if blob_id
        candidate && candidate.key == (asset["key"] || asset[:key]) &&
          Presentations::MediaAssets.digest(candidate) == params[:digest]
      end
      asset_id = manifest_asset && (manifest_asset["id"] || manifest_asset[:id])
      ActiveStorage::Blob.find_by(id: asset_id) if asset_id
    else
      @presentation.assets.blobs.find do |asset|
        Presentations::MediaAssets.digest(asset) == params[:digest]
      end
    end
    return head :not_found unless blob

    response.headers["Cache-Control"] = "private, no-store"
    send_data blob.download, type: blob.content_type, disposition: :inline, filename: blob.filename.to_s
  end

  def upload_asset
    upload = params.require(:file)
    content_type = upload.content_type.to_s
    unless content_type.start_with?("image/") || content_type == "video/mp4"
      return render json: { error: "Choose an image or MP4 video." }, status: :unprocessable_content
    end
    if upload.size.to_i > 50.megabytes
      return render json: { error: "Media files must be 50 MB or smaller." }, status: :unprocessable_content
    end

    @presentation.assets.attach(io: upload, filename: upload.original_filename, content_type: content_type)
    blob = @presentation.assets.blobs.last
    digest = Digest::SHA256.hexdigest(blob.download)
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    @presentation.reload
    render json: {
      digest: digest,
      lock_version: @presentation.lock_version,
      revision_token: @presentation.revision_token,
      source: Presentations::MediaAssets.markdown_source(
        digest,
        alt: params[:alt].presence || File.basename(upload.original_filename, ".*"),
        fit: %w[contain cover].include?(params[:fit]) ? params[:fit] : "contain"
      )
    }, status: :created
  end

  def media_asset
    return head :not_found unless params[:digest].to_s.match?(/\A[0-9a-f]{64}\z/)

    blob = @presentation.assets.blobs.find { |asset| Presentations::MediaAssets.digest(asset) == params[:digest] }
    return head :not_found unless blob

    redirect_to rails_blob_path(blob, disposition: "inline"), allow_other_host: false
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
    params.require(:presentation).permit(:title, :source, :theme, :typography)
  end

  def presentation_update_params
    params.require(:presentation).permit(
      :title, :source, :theme, :typography, :lock_version, :base_revision,
      :base_revision_id, :revision_token, :edit_session_id, :checkpoint, :reason
    )
  end
end
