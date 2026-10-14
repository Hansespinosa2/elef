class HostApiController < ApplicationController
  before_action :set_work, only: %i[show update rename destroy media_index media_destroy]

  # JSON surface for the Phase 01 host/client contract conformance suite.
  # Every action reuses an existing model/service path; no new product
  # behavior is introduced here.

  def index
    works = Work.where(workspace: host_workspace)
    works = works.where(kind: params[:kind]) if params[:kind].present?
    render json: works.recent_first.map { |work| work_summary(work) }
  end

  def create
    klass = params.require(:kind) == "presentation" ? Presentation : Document
    title = params.require(:title).to_s
    work = klass.new(workspace: host_workspace, title: title)
    work.source = params[:text].presence || "# #{title}\n"
    if work.save
      render json: work_snapshot(work), status: :created
    else
      render json: { error: work.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def show
    render json: work_snapshot(@work)
  end

  def update
    result = Drafts::Save.call(
      @work,
      source: params.require(:text).to_s,
      revision_token: params[:baseline_revision].to_s
    )
    if result.success?
      render json: work_snapshot(result.work)
    elsif result.conflict?
      render json: { current: work_snapshot(result.work) }, status: :conflict
    else
      render json: { error: result.errors.to_sentence }, status: :unprocessable_entity
    end
  end

  def rename
    title = params.require(:title).to_s
    if @work.document?
      source = Source::Document.replace_first_h1(@work.source, title)
      saved = @work.update(title: title, source: source)
    else
      saved = @work.update(title: title)
    end
    if saved
      render json: work_summary(@work)
    else
      render json: { error: @work.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def destroy
    orphan_ids = @work.presentation? ? PresentationLineageEdge.where(parent_work_id: @work.id).pluck(:child_work_id) : []
    @work.destroy!
    notes = Presentation.where(id: orphan_ids).filter_map do |orphan|
      note = orphan.library_card_note
      [orphan.id.to_s, note] if note
    end.to_h
    render json: { card_notes: notes }
  end

  def media_index
    render json: @work.assets.map { |asset| media_entry(asset) }
  end

  def media_destroy
    blob = @work.assets.blobs.find { |candidate| WorkAssets.digest(candidate) == params.require(:digest) }
    return head :not_found unless blob

    @work.assets.find_by(blob_id: blob.id)&.purge
    render json: { removed: true }
  end

  def settings_show
    render json: product_settings
  end

  def settings_update
    patch = params.permit(:theme, :typography).to_h.symbolize_keys
    workspace = host_workspace
    workspace.update_style_defaults(
      theme: patch.fetch(:theme, workspace.default_theme),
      typography: patch.fetch(:typography, workspace.default_typography)
    )
    render json: product_settings
  rescue ActiveRecord::RecordInvalid
    render json: { error: "Choose a valid workspace appearance." }, status: :unprocessable_entity
  end

  def imports_create
    upload = params.require(:package)
    work = WorkPackage::Importer.call(upload, workspace: host_workspace)
    render json: work_summary(work), status: :created
  rescue WorkPackage::ImportConflict => error
    render json: { error: error.message }, status: :conflict
  end

  private

  def host_workspace
    identifier = params[:workspace_id].to_s
    if identifier.blank? || identifier == "default"
      Workspace.default
    else
      Workspace.find(identifier)
    end
  end

  def set_work
    @work = host_workspace.works.find(params[:id])
  end

  def work_summary(work)
    {
      id: work.id.to_s,
      workspace_id: work.workspace_id.to_s,
      title: work.title,
      kind: work.kind,
      updated_at: work.updated_at.iso8601(3),
      warnings: work.preview_warnings
    }
  end

  def work_snapshot(work)
    work_summary(work).merge(
      text: work.source.to_s,
      baseline: { revision: work.revision_token }
    )
  end

  def media_entry(asset)
    blob = asset.blob
    {
      digest: WorkAssets.digest(blob),
      name: blob.filename.to_s,
      mime_type: blob.content_type,
      size: blob.byte_size
    }
  end

  def product_settings
    workspace = host_workspace
    { theme: workspace.default_theme, typography: workspace.default_typography }
  end
end
