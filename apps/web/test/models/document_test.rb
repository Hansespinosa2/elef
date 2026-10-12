require "test_helper"

class DocumentTest < ActiveSupport::TestCase
  test "rejects duplicate titles within a workspace" do
    Document.create!(title: "Existing notes", source: "# Existing")
    duplicate = Document.new(title: "Existing notes", source: "# Duplicate")

    assert_not duplicate.save
    assert_includes duplicate.errors.full_messages, "Title has already been taken"
  end
end
