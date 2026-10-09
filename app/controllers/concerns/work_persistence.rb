module WorkPersistence
  extend ActiveSupport::Concern

  MAX_UPLOAD_MEGABYTES = 50
  MAX_UPLOAD_BYTES = MAX_UPLOAD_MEGABYTES.megabytes

  private

  def save_draft(work, attributes)
    attributes = attributes.to_h.symbolize_keys
    attributes.delete(:editor_mode)
    editor_mode = submitted_editor_mode
    result = Drafts::Save.call(work, attributes)
    if result.success?
      respond_to do |format|
        format.html { redirect_to work_edit_path(work, editor_mode: editor_mode), notice: "#{work_type_label(work)} saved." }
        format.json { render json: draft_payload(result), status: :ok }
      end
    elsif result.conflict?
      respond_to do |format|
        format.html { redirect_to work_edit_path(work, editor_mode: editor_mode), alert: result.message }
        format.json { render json: draft_conflict_payload(result), status: :conflict }
      end
    else
      respond_to do |format|
        format.html { render :edit, status: :unprocessable_content }
        format.json { render json: { errors: result.errors, current: draft_payload(result) }, status: :unprocessable_content }
      end
    end
  end

  def draft_payload(result)
    work = result.work
    release = work.published_release
    {
      id: work.id,
      work_id: work.id,
      title: work.title,
      source: work.source,
      theme: work.theme_override,
      typography: work.typography_override,
      lock_version: work.lock_version,
      draft_digest: work.draft_digest,
      latest_checkpoint_id: result.checkpoint&.id || work.latest_checkpoint_id,
      latest_checkpoint: revision_payload(result.checkpoint || work.latest_checkpoint),
      current_revision_id: work.current_revision&.id,
      revision_token: work.revision_token,
      published_release_id: release&.id,
      published_release_status: work.published_release_status,
      published_release: release_payload(release),
      status: "saved"
    }
  end

  def draft_conflict_payload(result)
    {
      status: "conflict",
      message: result.message,
      current: draft_payload(result).merge(status: "current"),
      recovery_revision_id: result.recovery_revision.id,
      recovery_revision: revision_payload(result.recovery_revision)
    }
  end

  def revision_payload(revision)
    return nil unless revision

    {
      id: revision.id,
      source: revision.source,
      source_digest: revision.source_digest,
      reason: revision.reason,
      status: revision.status,
      created_at: revision.created_at&.iso8601
    }
  end

  def release_payload(release)
    return nil unless release

    {
      id: release.id,
      source_revision_id: release.source_revision_id,
      source_digest: release.source_digest,
      renderer_version: release.renderer_version,
      published_at: release.published_at&.iso8601,
      stale: release.stale?
    }
  end

  def work_edit_path(work, **options)
    work.document? ? edit_document_path(work, **options) : edit_presentation_path(work, **options)
  end

  def send_work_media_asset(work)
    blob = WorkAssets.resolve_blob(work, params[:digest])
    return head :not_found unless blob

    response.headers["Cache-Control"] = "private, max-age=3600"
    send_data blob.download, type: blob.content_type, disposition: :inline, filename: blob.filename.to_s
  end

  def render_work_history(work)
    render json: work.work_revisions.history.map { |revision| revision_payload(revision) }
  end

  def restore_work_revision(work)
    revision = work.work_revisions.find(params.require(:revision_id))
    result = DraftRestorer.call(work, revision)
    payload = draft_payload(Drafts::Save::Result.new(:saved, result.work, result.revision, nil, [], nil))
    respond_to do |format|
      format.html { redirect_to work_edit_path(work), notice: "Revision restored." }
      format.json { render json: payload, status: :ok }
    end
  end

  # allow_video adds MP4 to the accepted types; the optional block runs after the
  # work is reloaded, for callers that mirror the work to another store.
  def upload_work_asset(work, allow_video: false, &after_save)
    upload = params.require(:file)
    content_type = upload.content_type.to_s
    unless content_type.start_with?("image/") || (allow_video && content_type == "video/mp4")
      error = allow_video ? "Choose an image or MP4 video." : "Choose an image file."
      return render json: { error: error }, status: :unprocessable_content
    end
    if upload.size.to_i > MAX_UPLOAD_BYTES
      return render json: { error: "Media files must be #{MAX_UPLOAD_MEGABYTES} MB or smaller." }, status: :unprocessable_content
    end

    blob = WorkAssets.attach_upload(work, upload, content_type: content_type)
    digest = WorkAssets.digest(blob)
    work.reload
    after_save&.call(work)
    render json: {
      digest: digest,
      lock_version: work.lock_version,
      revision_token: work.revision_token,
      source: WorkAssets.markdown_source(
        digest,
        alt: params[:alt].presence || File.basename(upload.original_filename, ".*"),
        fit: %w[contain cover].include?(params[:fit]) ? params[:fit] : "contain"
      )
    }, status: :created
  end

  def work_type_label(work)
    work.document? ? "Document" : "Presentation"
  end

  def submitted_editor_mode
    "source" if params[:editor_mode] == "source"
  end

  def merge_draft_tokens(attributes)
    attributes = attributes.to_h.symbolize_keys
    %i[lock_version base_revision base_revision_id revision_token edit_session_id checkpoint reason].each do |key|
      attributes[key] = params[key] if !attributes.key?(key) && params.key?(key)
    end
    attributes
  end

  def export_work(work)
    package = WorkPackage::Exporter.call(work, include_revisions: params[:revisions].present?)
    send_data package,
      filename: "#{work.title.parameterize}-elef-work.zip",
      type: "application/zip",
      disposition: "attachment"
  end

  def import_work(upload)
    raise ActionController::ParameterMissing, "package" unless upload.respond_to?(:read)

    work = WorkPackage::Importer.call(upload)
    redirect_to work_edit_path(work), notice: "#{work_type_label(work)} imported."
  rescue WorkPackage::ImportConflict => error
    redirect_to root_path, alert: error.message
  end
end
