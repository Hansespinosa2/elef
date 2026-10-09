require "test_helper"

class HostApiControllerTest < ActionDispatch::IntegrationTest
  PIXEL = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=").freeze

  setup do
    Document.delete_all
    Presentation.delete_all
  end

  test "works CRUD round-trips snapshots with revision baselines" do
    post "/api/host/works", params: { workspace_id: "default", title: "API doc", kind: "document", text: "# API doc\n" }, as: :json
    assert_response :created
    created = response.parsed_body
    assert_equal "API doc", created["title"]
    assert_equal "document", created["kind"]
    assert_kind_of String, created["baseline"]["revision"]

    get "/api/host/works", params: { workspace_id: "default" }, as: :json
    assert_response :ok
    assert_includes response.parsed_body.map { |work| work["id"] }, created["id"]

    get "/api/host/works/#{created["id"]}", as: :json
    assert_response :ok
    assert_equal "# API doc\n", response.parsed_body["text"]

    patch "/api/host/works/#{created["id"]}",
      params: { text: "# API doc\n\nEdited.\n", baseline_revision: created["baseline"]["revision"] }, as: :json
    assert_response :ok
    assert_equal "# API doc\n\nEdited.\n", response.parsed_body["text"]

    patch "/api/host/works/#{created["id"]}/rename", params: { title: "Renamed doc" }, as: :json
    assert_response :ok
    assert_equal "Renamed doc", response.parsed_body["title"]

    delete "/api/host/works/#{created["id"]}", as: :json
    assert_response :ok
    assert_equal({}, response.parsed_body["card_notes"])
    assert_nil Document.find_by(id: created["id"])
  end

  test "destroy answers recomputed card notes for orphaned forks" do
    parent = Presentation.create!(title: "Note parent", source: "# Parent\n")
    child = parent.fork_as("inspiration")
    child.save!
    assert_equal "Forked from Note parent · inspiration", child.reload.library_card_note

    delete "/api/host/works/#{parent.id}", as: :json
    assert_response :ok
    assert_equal(
      { child.id.to_s => "Parent no longer available · inspiration" },
      response.parsed_body["card_notes"]
    )
  end

  test "stale baselines conflict with the current snapshot" do
    post "/api/host/works", params: { title: "Conflict doc", kind: "document", text: "# v1\n" }, as: :json
    created = response.parsed_body
    stale_revision = created["baseline"]["revision"]

    patch "/api/host/works/#{created["id"]}",
      params: { text: "# v2\n", baseline_revision: stale_revision }, as: :json
    assert_response :ok
    fresh_revision = response.parsed_body["baseline"]["revision"]

    patch "/api/host/works/#{created["id"]}",
      params: { text: "# stale\n", baseline_revision: stale_revision }, as: :json
    assert_response :conflict
    assert_equal "# v2\n", response.parsed_body["current"]["text"]
    assert_equal fresh_revision, response.parsed_body["current"]["baseline"]["revision"]
  end

  test "media lists, resolves, and removes uploads" do
    document = Document.create!(source: "# Media\n")
    digest = nil
    Tempfile.create(["pixel", ".png"]) do |file|
      file.binmode
      file.write(PIXEL)
      file.rewind
      upload = Rack::Test::UploadedFile.new(file.path, "image/png")
      post "/documents/#{document.id}/assets",
        params: { file: upload }, headers: { "Accept" => "application/json" }
    end
    assert_response :created
    digest = response.parsed_body["digest"]
    assert_equal Digest::SHA256.hexdigest(PIXEL), digest

    get "/api/host/works/#{document.id}/media", as: :json
    assert_response :ok
    assert_includes response.parsed_body.map { |item| item["digest"] }, digest

    get "/documents/#{document.id}/assets/#{digest}"
    assert_response :ok
    assert_equal "image/png", response.media_type
    assert_equal PIXEL.b, response.body.b

    delete "/api/host/works/#{document.id}/media/#{digest}", as: :json
    assert_response :ok
    assert_equal({ "removed" => true }, response.parsed_body)

    get "/api/host/works/#{document.id}/media", as: :json
    assert_empty response.parsed_body
  end

  test "settings and search serve the contract shapes" do
    get "/api/host/settings", as: :json
    assert_response :ok
    assert_includes response.parsed_body.keys, "theme"

    patch "/api/host/settings", params: { theme: "light" }, as: :json
    assert_response :ok
    assert_equal "light", response.parsed_body["theme"]

    Document.create!(source: "# Searchable deck\n")
    get "/search", params: { q: "Searchable deck" }, as: :json
    assert_response :ok
    assert_equal "Searchable deck", response.parsed_body["query"]
    assert_includes response.parsed_body["results"].map { |hit| hit["title"] }, "Searchable deck"
  end

  test "transfer exports and reimports a work package" do
    document = Document.create!(source: "# Transfer me\n")
    get "/documents/#{document.id}/export"
    assert_response :ok
    assert_equal "application/zip", response.media_type
    package = response.body.b
    assert_equal "PK", package[0, 2]

    document.destroy!
    Tempfile.create(["transfer", ".zip"]) do |file|
      file.binmode
      file.write(package)
      file.rewind
      upload = Rack::Test::UploadedFile.new(file.path, "application/zip")
      post "/api/host/imports", params: { package: upload }, headers: { "Accept" => "application/json" }
    end
    assert_response :created
    assert_equal "Transfer me", response.parsed_body["title"]
    assert_includes Document.last.source, "# Transfer me"
  end
end
