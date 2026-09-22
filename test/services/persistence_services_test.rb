require "test_helper"
require "stringio"

class PersistenceServicesTest < ActiveSupport::TestCase
  test "stale saves preserve the submitted content as a recovery revision" do
    work = Presentation.create!(title: "Concurrent", source: "# Initial")
    first = Drafts::Save.call(
      work,
      source: "# Server version",
      lock_version: work.lock_version,
      base_revision: work.revision_token,
      edit_session_id: "server-tab"
    )

    assert first.success?
    base_only_stale = Drafts::Save.call(
      work.reload,
      source: "# Base-only local version",
      base_revision: work.latest_checkpoint.id,
      edit_session_id: "base-only-tab"
    )

    assert base_only_stale.conflict?
    assert_equal "# Server version", work.reload.source

    stale = Drafts::Save.call(
      work.reload,
      source: "# Local version",
      lock_version: 0,
      base_revision: "0:stale",
      edit_session_id: "local-tab"
    )

    assert stale.conflict?
    assert_equal "# Server version", work.reload.source
    assert_equal "# Local version", stale.recovery_revision.source
    assert_equal "recovery", stale.recovery_revision.status
    assert_no_difference("WorkRevision.where(status: 'recovery').count") do
      repeated = Drafts::Save.call(
        work.reload,
        source: "# Local version",
        lock_version: 0,
        base_revision: "0:stale",
        edit_session_id: "local-tab"
      )
      assert repeated.conflict?
    end
  end

  test "checkpoints are grouped and restore creates a new immutable revision" do
    work = Document.create!(title: "History", source: "# Initial")
    initial = work.latest_checkpoint
    initial.update_columns(updated_at: 31.seconds.ago)

    saved = Drafts::Save.call(
      work,
      source: "# Checkpoint",
      lock_version: work.lock_version,
      base_revision: work.revision_token,
      edit_session_id: "typing-session"
    )

    assert saved.success?
    checkpoint = saved.checkpoint
    assert_equal "checkpoint", checkpoint.status
    assert_equal "typing-session", checkpoint.edit_session_id

    restored = DraftRestorer.call(work.reload, initial)

    assert_equal initial.source, work.reload.source
    assert_not_equal initial.id, restored.revision.id
    assert_equal "restore", restored.revision.reason
    assert_equal "restore", restored.revision.status
    assert_raises(ActiveRecord::ReadOnlyRecord) { restored.revision.update!(source: "# Mutated") }
  end

  test "publishing pins a release while later drafts become stale" do
    presentation = Presentation.create!(title: "Pinned", source: "# First")
    published = PresentationReleasePublisher.call(presentation)
    release = published.release

    Drafts::Save.call(
      presentation.reload,
      source: "# Later draft",
      lock_version: presentation.lock_version,
      base_revision: presentation.revision_token,
      checkpoint: true
    )

    assert release.reload.stale?
    assert_equal "# First", release.presentation.source
    assert_equal "stale", presentation.reload.published_release_status

    republished = PresentationReleasePublisher.call(presentation.reload)
    assert_equal "# Later draft", republished.release.presentation.source
    assert_equal republished.release.id, presentation.reload.published_release.id
    assert_equal republished.release.id, PresentationReleasePublisher.call(presentation.reload).release.id
  end

  test "published releases pin presentation metadata and detect asset changes" do
    presentation = Presentation.create!(title: "Pinned title", source: "# Published")
    release = PresentationReleasePublisher.call(presentation).release

    presentation.update!(title: "Renamed after publish")

    assert_equal "Pinned title", release.presentation.title
    assert_predicate release.reload, :stale?

    presentation.assets.attach(io: StringIO.new("asset bytes"), filename: "diagram.txt", content_type: "text/plain")

    assert_predicate release.reload, :stale?

    republished = PresentationReleasePublisher.call(presentation.reload).release
    assert_equal "Renamed after publish", republished.presentation.title
    assert_equal PresentationRelease.asset_manifest_for(presentation), republished.asset_manifest
    assert_not_predicate republished.reload, :stale?
  end

  test "destroying a published work removes its pinned release safely" do
    presentation = Presentation.create!(title: "Disposable release", source: "# Published")
    release = PresentationReleasePublisher.call(presentation).release

    presentation.destroy!

    assert_not Presentation.exists?(presentation.id)
    assert_not PresentationRelease.exists?(release.id)
  end

  test "forks retain origin provenance and remain independent after parent deletion" do
    parent = Presentation.create!(title: "Parent", source: "# Origin")
    child = parent.fork_as("inspiration")
    child.save!
    edge = child.lineage_edge

    assert_equal parent.latest_checkpoint.id, edge.origin_revision_id
    assert_equal "# Origin", child.fork_source

    parent.update!(source: "# Later parent draft")
    assert_equal "# Origin", child.reload.fork_source

    parent.destroy!

    assert_nil child.reload.parent
    assert_equal "# Origin", child.fork_source
    assert_equal "Parent", child.fork_parent_title
    assert_equal "# Origin", child.source
  end

  test "work packages round-trip stable identity, release provenance, and assets" do
    source = "# Published\n\nOriginal content"
    presentation = Presentation.create!(title: "Package", source: source)
    presentation.assets.attach(io: StringIO.new("asset bytes"), filename: "diagram.txt", content_type: "text/plain")
    PresentationReleasePublisher.call(presentation)
    Drafts::Save.call(
      presentation.reload,
      source: "# Current draft",
      lock_version: presentation.lock_version,
      base_revision: presentation.revision_token,
      checkpoint: true
    )
    target_workspace = Workspace.create!(name: "Package import", slug: "package-import-#{SecureRandom.hex(6)}")

    package = WorkPackage::Exporter.call(presentation.reload, include_revisions: true)
    imported = WorkPackage::Importer.call(StringIO.new(package), workspace: target_workspace)

    assert_equal "# Current draft", imported.source
    assert_equal "# Published\n\nOriginal content", imported.published_release.presentation.source
    assert_equal presentation.published_release.source_digest, imported.published_release.source_digest
    assert_equal ["diagram.txt"], imported.assets.map { |asset| asset.filename.to_s }
    assert_equal "text/plain", imported.assets.first.content_type
    assert_equal presentation.presentation_detail.settings, imported.presentation_detail.settings
    assert_equal PresentationRelease.asset_manifest_for(imported), imported.published_release.asset_manifest
  end

  test "imported forks do not attach to a parent in another workspace by numeric id" do
    parent = Presentation.create!(title: "Package parent", source: "# Origin")
    child = parent.fork_as("inspiration")
    child.save!
    target_workspace = Workspace.create!(name: "Fork import", slug: "fork-import-#{SecureRandom.hex(6)}")

    package = WorkPackage::Exporter.call(child)
    imported = WorkPackage::Importer.call(StringIO.new(package), workspace: target_workspace)

    assert_nil imported.reload.parent
    assert_equal parent.title, imported.fork_parent_title
    assert_equal parent.source, imported.fork_source
  end

  test "document packages preserve stable identity and aliases" do
    document = Document.create!(title: "Original title", source: "# Notes")
    document.update!(title: "Renamed title")
    document_key = document.document_key
    package = WorkPackage::Exporter.call(document, include_revisions: true)
    target_workspace = Workspace.create!(name: "Document import", slug: "document-import-#{SecureRandom.hex(6)}")
    document.destroy!

    imported = WorkPackage::Importer.call(StringIO.new(package), workspace: target_workspace)

    assert_equal document_key, imported.document_key
    assert_equal ["Original title", "Renamed title"], imported.aliases.map(&:alias_name)
    assert_equal imported, Document.resolve_link("Original title", workspace: target_workspace)
  end

  test "render cache keys change with source, renderer, settings, and assets" do
    base = Presentations::RenderCache.key(source: "# One", settings: { "theme" => "light" }, asset_manifest: [])

    refute_equal base, Presentations::RenderCache.key(source: "# Two", settings: { "theme" => "light" }, asset_manifest: [])
    refute_equal base, Presentations::RenderCache.key(source: "# One", renderer_version: "next", settings: { "theme" => "light" }, asset_manifest: [])
    refute_equal base, Presentations::RenderCache.key(source: "# One", settings: { "theme" => "dark" }, asset_manifest: [])
    refute_equal base, Presentations::RenderCache.key(source: "# One", settings: { "theme" => "light" }, asset_manifest: [{ "checksum" => "abc" }])
  end
end
