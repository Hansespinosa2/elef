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
end
