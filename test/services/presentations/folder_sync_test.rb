require "test_helper"
require "fileutils"

class FolderSyncTest < ActiveSupport::TestCase
  test "syncs presentation and attached assets to disk storage folder and removes on destroy" do
    presentation = Presentation.create!(title: "Folder Sync Deck", source: "# Welcome\n\nIntro text.")
    storage_dir = presentation.storage_dir

    assert File.exist?(storage_dir.join("presentation.md"))
    assert_equal "# Welcome\n\nIntro text.", File.read(storage_dir.join("presentation.md"))
    assert File.exist?(storage_dir.join("source.md"))

    # Attach an image asset
    bytes = "dummy png content".b
    presentation.assets.attach(io: StringIO.new(bytes), filename: "dummy_photo.png", content_type: "image/png")
    digest = Digest::SHA256.hexdigest(bytes)
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    presentation.reload.update!(source: "# Welcome\n\n![Dummy](elef-asset:#{digest} \"fit:contain\")")

    assert File.exist?(storage_dir.join("assets/dummy_photo.png"))
    assert_equal bytes, File.binread(storage_dir.join("assets/dummy_photo.png"))
    assert_includes File.read(storage_dir.join("presentation.md")), "![Dummy](assets/dummy_photo.png \"fit:contain\")"

    # Clean up when presentation is destroyed
    presentation.destroy!
    refute File.exist?(storage_dir)
  end

  test "does not rewrite an attached asset when its on-disk size is unchanged" do
    presentation = Presentation.create!(title: "Unchanged asset", source: "# Asset")
    bytes = "unchanged bytes".b
    presentation.assets.attach(io: StringIO.new(bytes), filename: "same.bin", content_type: "application/octet-stream")
    storage_dir = presentation.storage_dir
    assert_equal storage_dir, Presentations::FolderSync.sync!(presentation)
    asset_path = storage_dir.join("assets/same.bin")
    old_time = Time.at(1)
    File.utime(old_time, old_time, asset_path)

    begin
      assert_equal storage_dir, Presentations::FolderSync.sync!(presentation)
      assert_equal old_time, File.mtime(asset_path)
      assert_equal bytes, File.binread(asset_path)
    ensure
      Presentations::FolderSync.remove!(presentation)
    end
  end

  test "removes detached assets from the synchronized folder" do
    presentation = Presentation.create!(title: "Detached asset", source: "# Asset")
    presentation.assets.attach(io: StringIO.new("asset"), filename: "removed.bin", content_type: "application/octet-stream")
    storage_dir = presentation.storage_dir
    Presentations::FolderSync.sync!(presentation)
    asset_path = storage_dir.join("assets/removed.bin")
    assert File.exist?(asset_path)

    begin
      presentation.assets.detach
      assert_equal storage_dir, Presentations::FolderSync.sync!(presentation)
      refute File.exist?(asset_path)
    ensure
      Presentations::FolderSync.remove!(presentation)
    end
  end

  test "returns nil when folder synchronization raises and restores the path resolver" do
    presentation = Presentation.create!(title: "Failed folder sync", source: "# Asset")
    original_resolver = Presentations::FolderSync.method(:presentation_dir)
    Presentations::FolderSync.define_singleton_method(:presentation_dir) do |_record|
      raise IOError, "controlled storage failure"
    end

    assert_nil Presentations::FolderSync.sync!(presentation)
  ensure
    Presentations::FolderSync.define_singleton_method(:presentation_dir, original_resolver) if original_resolver
    Presentations::FolderSync.remove!(presentation) if presentation
  end
end
