class PresentationReleasePublisher
  Result = Data.define(:release, :revision)

  def self.call(presentation)
    new(presentation).call
  end

  def initialize(presentation)
    @presentation = presentation
  end

  def call
    @presentation.with_lock do
      revision = source_revision
      settings = {
        "title" => @presentation.title,
        "theme" => @presentation.theme,
        "typography" => @presentation.typography,
        "margin" => margin_settings
      }
      asset_manifest = assets_manifest
      source_digest = revision.source_digest
      render_digest = Digest::SHA256.hexdigest(
        [source_digest, PresentationRelease::RENDERER_VERSION, JSON.generate(settings), JSON.generate(asset_manifest)].join("\0")
      )
      release = PresentationRelease.find_by(work: @presentation, render_digest: render_digest)
      release ||= PresentationRelease.create!(
        work: @presentation,
        source_revision: revision,
        source_digest: source_digest,
        renderer_version: PresentationRelease::RENDERER_VERSION,
        settings: settings,
        asset_manifest: asset_manifest,
        render_digest: render_digest,
        published_at: Time.current
      )
      @presentation.update_columns(published_release_id: release.id, updated_at: Time.current)
      @presentation.association(:published_release).target = release
      Result.new(release, revision)
    end
  end

  private

  def source_revision
    @presentation.association(:latest_checkpoint).reset
    revision = @presentation.latest_checkpoint
    return revision if revision && revision.source_digest == @presentation.draft_digest

    revision = @presentation.work_revisions.create!(
      workspace: @presentation.workspace,
      parent_revision: revision,
      source: @presentation.source.to_s,
      source_digest: @presentation.draft_digest,
      reason: "publish",
      status: "checkpoint",
      edit_session_id: "publish"
    )
    @presentation.update_columns(latest_checkpoint_id: revision.id)
    revision
  end

  def margin_settings
    settings = @presentation.document.margin_settings
    {
      "section" => settings.section,
      "subsection" => settings.subsection,
      "footnote" => settings.footnote,
      "slide_count" => settings.slide_count
    }
  end

  def assets_manifest
    PresentationRelease.asset_manifest_for(@presentation)
  end
end

PresentationPublisher = PresentationReleasePublisher
