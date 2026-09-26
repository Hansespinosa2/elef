require "test_helper"

class PresentationsMediaAssetsTest < ActiveSupport::TestCase
  test "asset routes include the configured relative URL root" do
    previous_root = Rails.application.config.relative_url_root
    Rails.application.config.relative_url_root = "/apps/elef/dev"
    assert_equal "/apps/elef/dev/documents/36/assets/abc",
      Presentations::MediaAssets.asset_path(Document.new(id: 36), "abc")
    assert_equal "/apps/elef/dev/presentations/8/assets/abc",
      Presentations::MediaAssets.asset_path(Presentation.new(id: 8), "abc")
  ensure
    Rails.application.config.relative_url_root = previous_root
  end
end
