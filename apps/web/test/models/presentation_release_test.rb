require "test_helper"

class PresentationReleaseTest < ActiveSupport::TestCase
  setup do
    @presentation = Presentation.create!(title: "Release Presentation", source: "# Original")
    @published = PresentationReleasePublisher.call(@presentation)
    @release = @published.release
  end

  test "release records are strictly immutable on update" do
    assert_raises(ActiveRecord::ReadOnlyRecord) do
      @release.update!(source_digest: "new_digest")
    end
  end

  test "release records are protected against individual deletion" do
    assert_raises(ActiveRecord::ReadOnlyRecord) do
      @release.destroy!
    end
  end

  test "validates that work must be a presentation" do
    doc = Document.create!(title: "Doc", source: "# Doc")
    doc_revision = doc.latest_checkpoint
    invalid_release = PresentationRelease.new(
      work: doc,
      source_revision: doc_revision,
      source_digest: doc_revision.source_digest,
      render_digest: "test_render",
      renderer_version: PresentationRelease::RENDERER_VERSION,
      published_at: Time.current
    )
    refute invalid_release.valid?
    assert_includes invalid_release.errors[:work], "must be a presentation"
  end

  test "validates that source_revision belongs to the associated work" do
    other_pres = Presentation.create!(title: "Other Deck", source: "# Other")
    other_revision = other_pres.latest_checkpoint
    invalid_release = PresentationRelease.new(
      work: @presentation,
      source_revision: other_revision,
      source_digest: other_revision.source_digest,
      render_digest: "test_render",
      renderer_version: PresentationRelease::RENDERER_VERSION,
      published_at: Time.current
    )
    refute invalid_release.valid?
    assert_includes invalid_release.errors[:source_revision], "must belong to the released work"
  end

  test "tracks stale and current states based on draft source and title" do
    assert @release.current?
    refute @release.stale?

    # Draft source change causes staleness
    @presentation.update!(source: "# Modified Draft")
    assert @release.stale?
    refute @release.current?

    # Reverting source restores freshness
    @presentation.update!(source: "# Original")
    refute @release.stale?
    assert @release.current?

    # Title change causes staleness
    @presentation.update!(title: "Renamed Title")
    assert @release.stale?

    # Reverting title restores freshness
    @presentation.update!(title: "Release Presentation")
    refute @release.stale?
  end

  test "marks a release stale when its renderer version is no longer current" do
    assert_not_predicate @release, :stale?

    @release.update_columns(renderer_version: "retired-renderer")

    assert_predicate @release.reload, :stale?
  end

  test "marks a release stale when its asset manifest changes" do
    @presentation.assets.attach(
      io: StringIO.new("released image bytes"),
      filename: "released.png",
      content_type: "image/png"
    )

    assert_predicate @release.reload, :stale?
  end
end
