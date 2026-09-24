require "test_helper"
require "tempfile"

class PresentationsControllerTest < ActionDispatch::IntegrationTest
  test "library rename form submits scoped parameters" do
    get presentations_path
    assert_select "form[action='#{rename_presentation_path(presentations(:one))}']" do
      assert_select "input[name='presentation[title]']"
    end
  end

  test "renames without changing source and rejects an oversized title" do
    presentation = presentations(:one)
    source = presentation.source
    patch rename_presentation_path(presentation), params: { presentation: { title: "Renamed", source: "overwrite" } }
    assert_redirected_to presentations_path
    assert_equal "Renamed", presentation.reload.title
    assert_equal source, presentation.source

    patch rename_presentation_path(presentation), params: { presentation: { title: "x" * 121 } }
    assert_redirected_to presentations_path
    assert_match /too long/, flash[:alert]
    assert_equal "Renamed", presentation.reload.title
  end

  test "autosaves JSON and returns validation errors without overwriting saved data" do
    presentation = presentations(:one)
    patch presentation_path(presentation), params: { presentation: { source: "# Autosaved" } }, as: :json
    assert_response :ok
    assert_equal presentation.id, response.parsed_body["id"]
    assert_equal "# Autosaved", presentation.reload.source

    patch presentation_path(presentation), params: { presentation: { title: "x" * 121, source: "# Invalid" } }, as: :json
    assert_response :unprocessable_content
    assert_match /too long/, response.parsed_body["errors"].join
    assert_equal "# Autosaved", presentation.reload.source
  end

  test "stale JSON saves return recovery metadata without overwriting the server draft" do
    presentation = Presentation.create!(title: "Concurrent", source: "# Initial")
    lock_version = presentation.lock_version
    base_revision = presentation.revision_token

    patch presentation_path(presentation), params: {
      presentation: { source: "# Server", lock_version: lock_version, base_revision: base_revision }
    }, as: :json
    assert_response :ok

    patch presentation_path(presentation), params: {
      presentation: { source: "# Local", lock_version: lock_version, base_revision: base_revision }
    }, as: :json

    assert_response :conflict
    assert_equal "conflict", response.parsed_body["status"]
    assert_predicate response.parsed_body["recovery_revision_id"], :present?
    assert_equal "# Local", response.parsed_body.dig("recovery_revision", "source")
    assert_equal "# Server", presentation.reload.source
  end

  test "forks both relationship types and rejects unsupported types" do
    parent = presentations(:one)
    Presentation::FORK_TYPES.each do |type|
      assert_difference("Presentation.count") { post fork_presentation_path(parent), params: { fork_type: type } }
      child = parent.children.order(:id).last
      assert_redirected_to edit_presentation_path(child)
      assert_equal type, child.fork_type
      assert_equal parent.source, child.fork_source
    end
    assert_no_difference("Presentation.count") { post fork_presentation_path(parent), params: { fork_type: "invalid" } }
    assert_redirected_to presentations_path
    assert_equal "Choose a valid fork type.", flash[:alert]
  end

  test "deleting a parent retains its fork and provenance" do
    parent = presentations(:one)
    child = parent.fork_as("inspiration")
    child.save!
    assert_difference("Presentation.count", -1) { delete presentation_path(parent) }
    assert_redirected_to presentations_path
    assert_nil child.reload.parent_id
    assert_equal parent.source, child.fork_source
    assert_equal parent.title, child.fork_parent_title
  end

  test "publishing records the last published time while presentation mode stays read-only" do
    presentation = presentations(:one)
    get presentation_path(presentation)
    assert_nil presentation.reload.last_published_at
    freeze_time do
      get present_presentation_path(presentation)
      assert_response :success
      assert_nil presentation.reload.last_published_at

      post publish_presentation_path(presentation)
      assert_redirected_to present_presentation_path(presentation)
      assert_equal Time.current, presentation.reload.last_published_at
    end
  end

  test "present mode remains pinned when the draft changes after publishing" do
    presentation = Presentation.create!(title: "Pinned", source: "# Published")
    post publish_presentation_path(presentation)
    patch presentation_path(presentation), params: { presentation: { source: "# Draft" } }

    get present_presentation_path(presentation)

    assert_response :success
    assert_select ".presentation-slide h1", text: "Published"
    assert_select ".presentation-slide h1", text: "Draft", count: 0
    assert_select ".presentation-release-warning", text: /newer changes/
  end

  test "editor wires autosave and keeps new presentations client-only until creation" do
    get edit_presentation_path(presentations(:one))
    assert_select 'form[data-controller~="autosave"]'
    assert_select "form[action='#{publish_presentation_path(presentations(:one))}'] button.button", text: "Present"
    assert_select 'form[data-controller~="autosave"] form', count: 0
    assert_select '[data-autosave-target="retry"]'
    assert_select '[data-controller~="editor"]'
    assert_select '[data-editor-target="surface"][aria-labelledby]'
    assert_select 'textarea[name="presentation[source]"][data-editor-target="input"]'
    assert_select '[data-editor-target="mode"]', text: "Standard"
    assert_select '[data-editor-target="vimToggle"]'
    assert_select 'button[data-dirty-navigation]', text: "Present"
    assert_select "a[href='#{print_presentation_path(presentations(:one))}']", text: "Print draft / save PDF"
    get new_presentation_path
    assert_select 'form[data-controller~="autosave"][data-autosave-save-enabled-value="false"]'
    assert_select 'form[data-controller~="preview"]'
    assert_select 'form[data-preview-url-value="/presentations/preview"]'
    assert_select 'form[data-controller~="slide-overview"][data-controller~="media"]'
    assert_select '[data-slide-overview-target="grid"][role="group"]'
    assert_select '.preview-pane[data-action="dragover->media#dragOver dragleave->media#dragLeave drop->media#drop"]'
    assert_select 'button[data-action="media#choose"]', text: "Add image or MP4"
  end

  test "uploads image assets with content digest references and rejects other files" do
    presentation = Presentation.create!(title: "Media upload", source: "# Media")
    bytes = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=")
    Tempfile.create(["pixel", ".png"]) do |file|
      file.binmode
      file.write(bytes)
      file.rewind
      upload = Rack::Test::UploadedFile.new(file.path, "image/png")
      post upload_asset_presentation_path(presentation), params: { file: upload, fit: "cover", alt: "Pixel" }, headers: { "Accept" => "application/json" }
    end

    assert_response :created
    digest = Digest::SHA256.hexdigest(bytes)
    assert_equal digest, response.parsed_body["digest"]
    assert_equal "![Pixel](elef-asset:#{digest} \"fit:cover\")", response.parsed_body["source"]
    blob = presentation.assets.blobs.last
    assert_equal digest, blob.metadata["elef_sha256"]

    presentation.reload.update!(source: "# Pixel\n\n#{response.parsed_body["source"]}")
    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-media-cover[src='/presentations/#{presentation.id}/assets/#{digest}'][alt='Pixel']"

    get media_asset_presentation_path(presentation, digest)
    assert_response :redirect
    assert_includes response.location, "/rails/active_storage/blobs/redirect/"

    video_bytes = "mp4 test bytes".b
    Tempfile.create(["clip", ".mp4"]) do |file|
      file.binmode
      file.write(video_bytes)
      file.rewind
      video = Rack::Test::UploadedFile.new(file.path, "video/mp4")
      post upload_asset_presentation_path(presentation), params: { file: video, fit: "contain", alt: "Clip" }, headers: { "Accept" => "application/json" }
    end
    assert_response :created
    video_digest = response.parsed_body["digest"]
    video_source = response.parsed_body["source"]
    assert_equal Digest::SHA256.hexdigest(video_bytes), video_digest
    assert_equal "![Clip](elef-asset:#{video_digest} \"fit:contain\")", video_source

    presentation.reload.update!(source: "# Media\n\n#{response.parsed_body["source"]}")
    get presentation_path(presentation)
    assert_select "video.presentation-media-contain[src='/presentations/#{presentation.id}/assets/#{video_digest}'][controls][playsinline]"
    post publish_presentation_path(presentation)
    get present_presentation_path(presentation)
    assert_select ".presentation-slide video[src='/presentations/#{presentation.id}/assets/#{video_digest}'][controls]"

    Tempfile.create(["notes", ".txt"]) do |file|
      file.write("not media")
      file.rewind
      invalid = Rack::Test::UploadedFile.new(file.path, "text/plain")
      post upload_asset_presentation_path(presentation), params: { file: invalid }, headers: { "Accept" => "application/json" }
    end
    assert_response :unprocessable_content
    assert_equal "Choose an image or MP4 video.", response.parsed_body["error"]
  end

  test "print view selects the latest draft or published release" do
    presentation = Presentation.create!(title: "Print selection", source: "# Published version")
    post publish_presentation_path(presentation)
    patch presentation_path(presentation), params: { presentation: { source: "# Latest draft" } }

    get print_presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-print-toolbar", text: /Latest draft/
    assert_select ".presentation-print .slide h1", text: "Latest draft"

    get print_presentation_path(presentation, version: "published")
    assert_response :success
    assert_select ".presentation-print-toolbar", text: /Published release/
    assert_select ".presentation-print .slide h1", text: "Published version"
    assert_select ".presentation-print .slide h1", text: "Latest draft", count: 0
  end

  test "PPTX JSON describes the latest draft with slide geometry inputs and typography" do
    presentation = presentations(:one)

    get pptx_presentation_path(presentation, version: "draft")

    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]
    payload = response.parsed_body
    assert_equal "draft", payload["version"]
    assert_equal "Demo Deck.pptx", payload["filename"]
    assert_equal 1280, payload.dig("presentation", "width")
    assert_equal 720, payload.dig("presentation", "height")
    assert_equal "book", payload.dig("presentation", "typography")
    assert_equal 2, payload["slides"].length
    assert_includes payload.dig("slides", 0, "blocks", 0, "html"), "One"
    assert_includes payload.dig("slides", 1, "blocks", 0, "html"), "Two"
  end

  test "PPTX POST exports unsaved form values without persisting them" do
    presentation = Presentation.create!(title: "Saved presentation", source: "# Saved source")

    post pptx_presentation_path(presentation, version: "draft"), params: {
      presentation: {
        title: "Unsaved title",
        source: "# Unsaved source",
        theme: "dark",
        typography: "technical"
      }
    }

    assert_response :success
    payload = response.parsed_body
    assert_equal "Unsaved title.pptx", payload["filename"]
    assert_equal "dark", payload.dig("presentation", "theme")
    assert_equal "technical", payload.dig("presentation", "typography")
    assert_includes payload.dig("slides", 0, "blocks", 0, "html"), "Unsaved source"
    assert_equal "# Saved source", presentation.reload.source
    assert_equal "Saved presentation", presentation.title
  end

  test "PPTX export selects a pinned release and requires one for published exports" do
    presentation = Presentation.create!(title: "PPTX versions", source: "# Published copy")
    get pptx_presentation_path(presentation, version: "published")
    assert_response :not_found

    post publish_presentation_path(presentation)
    patch presentation_path(presentation), params: { presentation: { source: "# Current draft" } }

    get pptx_presentation_path(presentation, version: "draft")
    assert_response :success
    assert_includes response.parsed_body.dig("slides", 0, "blocks", 0, "html"), "Current draft"

    get pptx_presentation_path(presentation, version: "published")
    assert_response :success
    assert_equal "published", response.parsed_body["version"]
    assert_includes response.parsed_body.dig("slides", 0, "blocks", 0, "html"), "Published copy"
  end

  test "published PPTX keeps the release theme and typography after workspace defaults change" do
    workspace = presentations(:one).workspace
    workspace.update_style_defaults(theme: "dark", typography: "technical")
    presentation = Presentation.create!(workspace:, title: "Pinned style", source: "# Original style")
    post publish_presentation_path(presentation)
    workspace.update_style_defaults(theme: "light", typography: "modern")

    get pptx_presentation_path(presentation, version: "published")

    assert_response :success
    assert_equal "dark", response.parsed_body.dig("presentation", "theme")
    assert_equal "technical", response.parsed_body.dig("presentation", "typography")

    get pptx_presentation_path(presentation, version: "draft")
    assert_equal "light", response.parsed_body.dig("presentation", "theme")
    assert_equal "modern", response.parsed_body.dig("presentation", "typography")
  end

  test "published PPTX asset requests can read the release asset after draft detaches it" do
    bytes = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=")
    digest = Digest::SHA256.hexdigest(bytes)
    presentation = Presentation.create!(title: "Pinned asset", source: "# Asset\n\n![Pixel](elef-asset:#{digest})")
    presentation.assets.attach(io: StringIO.new(bytes), filename: "pixel.png", content_type: "image/png")
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    post publish_presentation_path(presentation)
    release_id = presentation.reload.published_release.id
    presentation.assets.detach

    get pptx_presentation_path(presentation, version: "published")
    assert_response :success
    html = response.parsed_body.dig("slides", 0, "blocks", 1, "html")
    assert_includes html, "/presentations/#{presentation.id}/pptx_assets/#{digest}?version=published&amp;release_id=#{release_id}"

    presentation.update!(source: "# New release")
    post publish_presentation_path(presentation)

    get pptx_asset_presentation_path(id: presentation, digest:, version: "published", release_id:)
    assert_response :success
    assert_equal "image/png", response.media_type
    assert_equal bytes, response.body

    get pptx_asset_presentation_path(id: presentation, digest:, version: "draft")
    assert_response :not_found
  end

  test "PPTX export reports linked HTTP images that cannot be embedded safely" do
    presentation = Presentation.create!(title: "Unsafe remote image", source: "# Image\n\n![Remote](http://example.org/image.png)")

    get pptx_presentation_path(presentation, version: "draft")

    assert_response :unprocessable_content
    assert_match /public HTTPS/, response.parsed_body["error"]
  end

  test "PPTX editor actions expose draft and published exports" do
    presentation = presentations(:one)
    get edit_presentation_path(presentation)
    assert_select '[data-controller="pptx-export"][data-pptx-export-url-value=?]', pptx_presentation_path(presentation, version: "draft") do
      assert_select "button", text: "Download PPTX draft"
    end

    post publish_presentation_path(presentation)
    get edit_presentation_path(presentation)
    assert_select '[data-controller="pptx-export"][data-pptx-export-url-value=?]', pptx_presentation_path(presentation, version: "published") do
      assert_select "button", text: "Download published PPTX"
    end
  end

  test "previews an unsaved presentation without creating a record" do
    assert_no_difference("Presentation.count") do
      post preview_presentations_path, params: {
        presentation: { title: "Draft deck", source: "# Draft deck\n---\n# Next" }, revision: "new-2"
      }, as: :json
    end

    assert_response :success
    assert_equal "new-2", response.parsed_body["revision"]
    assert_equal 2, response.parsed_body["html"].scan('class="slide ').length
  end

  test "the root library shows all work while the presentations URL stays presentation-focused" do
    Document.create!(title: "Root notes", source: "# Root notes")

    get root_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select "#document_#{Document.order(:id).last.id}"

    get presentations_path
    assert_select "h1", "Library"
    assert_select "#document_#{Document.order(:id).last.id}", count: 0
  end

  test "presentation collection no longer interprets type query filters" do
    document = Document.create!(title: "Query notes", source: "# Query notes")

    get presentations_path, params: { type: "all" }

    assert_response :success
    assert_select "#document_#{document.id}", count: 0
    assert_select "#presentation_#{presentations(:one).id}"
  end

  test "the all library is a combined list without relationship graphs" do
    Document.create!(title: "All notes", source: "# Notes")

    get root_path

    assert_select ".document-graph", count: 0
    assert_select ".lineage-panel", count: 0
    assert_select "#document_#{Document.order(:id).last.id}"
    assert_select "#presentation_#{presentations(:one).id}"
  end

  test "library loads" do
    get presentations_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select 'body.elef-app'
    assert_select 'link[href*="tailwind"]'
    assert_select 'link[href*="katex/katex.min"]'
  end

  test "loads sample presentations idempotently and preserves unrelated records" do
    unrelated = Presentation.create!(title: "Personal deck", source: "# Keep me")

    expected_seed_records = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_seed_records) do
      post load_samples_presentations_path
    end
    assert_redirected_to presentations_path
    assert_equal "Sample presentations loaded.", flash[:notice]
    Presentations::SampleData::SAMPLES.each do |sample|
      assert_equal sample[:source], Presentation.find_by!(sample_id: sample[:id]).reload.source
    end

    assert_no_difference("Presentation.count") do
      post load_samples_presentations_path
    end
    assert_equal "# Keep me", unrelated.reload.source
    assert_equal expected_seed_records,
      Presentation.where.not(sample_id: nil).count
    assert_equal Presentations::SampleData::SAMPLES.length,
      Presentation.where("source LIKE ?", "%#{Presentations::SampleData::MARKER_KEY}%").count
  end

  test "loads samples through the Rails seed entry point" do
    expected_seed_records = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_seed_records) do
      Rails.application.load_seed
    end

    assert_no_difference("Presentation.count") do
      Rails.application.load_seed
    end
  end

  test "creates a presentation from markdown source" do
    assert_difference("Presentation.count", 1) do
      post presentations_path, params: { presentation: { title: "Request Deck", source: "# One\n---\n# Two" } }
    end

    presentation = Presentation.order(:created_at).last
    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# One\n---\n# Two", presentation.source
  end

  test "updates source only on explicit save request" do
    presentation = presentations(:one)

    patch presentation_path(presentation), params: { presentation: { title: "Updated", source: "# Saved\n---\n# Again" } }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# Saved\n---\n# Again", presentation.reload.source
  end

  test "saves generic typography in front matter" do
    presentation = presentations(:one)

    patch presentation_path(presentation), params: {
      presentation: { title: presentation.title, source: presentation.source, typography: "modern" }
    }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "modern", presentation.reload.typography
    assert_includes presentation.source, "typography: modern"
  end

  test "updates typography inside valid front matter" do
    presentation = Presentation.create!(title: "Front matter deck", source: "---\ntheme: dark\ntypography: modern\n---\n# Title")

    patch presentation_path(presentation), params: {
      presentation: { title: presentation.title, source: presentation.source, typography: "book" }
    }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "book", presentation.reload.typography
    assert_includes presentation.source, "theme: dark"
    assert_includes presentation.source, "typography: book"
  end

  test "renders saved preview and presentation mode" do
    presentation = presentations(:one)

    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-surface"
    assert_select ".slides-typography-book"
    assert_select ".slide", 2
    assert_select "h1", text: "One"

    get present_presentation_path(presentation)
    assert_response :success
    assert_select "body.presentation-body"
    assert_select ".presentation-mode.presentation-surface"
    assert_select ".slides-typography-book"
    assert_select 'link[href*="tailwind"]', count: 0
    assert_select 'link[rel="icon"][href="/icon.svg"]'
    assert_select ".presentation-slide", 2
  end

  test "renders margin metadata and slide count in both views" do
    presentation = Presentation.create!(title: "Margin deck", source: <<~MARKDOWN)
      ---
      show-in-margin:
        section: true
        subsection: true
        footnote: true
        slideCount: true
      ---
      :::section{Product strategy}
      :::subsection{Opportunity}
      # First
      :::footnote{Source: customer interviews}
      ---
      # Second
    MARKDOWN

    get presentation_path(presentation)
    assert_select ".slide-margin-section", text: "Product strategy", count: 2
    assert_select ".slide-margin-subsection", text: "Opportunity", count: 2
    assert_select ".slide-margin-footnote", text: /Source: customer interviews/, count: 1
    assert_select ".slide-margin-footnote-marker", text: "*", count: 1
    assert_select ".slide-margin-count", text: "1 / 2", count: 1
    assert_select ".slide-margin-count", text: "2 / 2", count: 1

    get present_presentation_path(presentation)
    assert_select ".presentation-toolbar [data-presentation-target='counter']", count: 0
    assert_select ".presentation-slide .slide-margin-section", text: "Product strategy", count: 2
  end

  test "renders representative sample content in the saved preview" do
    Presentations::SampleData.load!
    sample = Presentation.find_by!(sample_id: "code-and-math")

    get presentation_path(sample)

    assert_response :success
    assert_select ".slides-theme-match"
    assert_select ".katex", 4
    assert_select ".katex-display", 3
    assert_select "pre code", text: /puts/
    assert_select ".slide", 10

    tables_and_media = Presentation.find_by!(sample_id: "tables-and-media")
    get presentation_path(tables_and_media)

    assert_select "table"
    assert_select 'img[alt="Elef authoring workflow"][src="https://example.com/elef-workflow.png"]'
    assert_select 'a[href="https://example.com/elef"]'

    layouts_and_themes = Presentation.find_by!(sample_id: "layouts-and-themes")
    get presentation_path(layouts_and_themes)

    assert_select ".slides-theme-dark"
    assert_select ".slide-body"
    assert_select ".slide-statement"
    assert_select ".slide-two-column .slide-regions", 2
    assert_select ".slide-three-column .slide-regions", 5

    edge_cases = Presentation.find_by!(sample_id: "slide-edge-cases")
    get presentation_path(edge_cases)

    assert_select ".slide", 10
  end

  test "renders every seeded lineage presentation in the timeline" do
    Presentations::LineageSampleData.load!

    get presentations_path

    assert_response :success
    assert_select ".lineage-timeline-scroll"
    assert_select ".lineage-node", count: Presentation.count
    assert_select ".lineage-node[data-lineage-graph-created-at]", count: Presentation.count
    assert_select ".lineage-date-axis"
  end

  test "editor exposes the generic typography selector" do
    get edit_presentation_path(presentations(:one))

    assert_response :success
    assert_select "select[name='presentation[typography]']" do
      assert_select "option[value='book']", text: "Book"
      assert_select "option[value='modern']", text: "Modern"
      assert_select "option[value='technical']", text: "Technical"
    end
  end

  test "renders positioning warnings without leaking directives" do
    presentation = Presentation.create!(title: "Warnings", source: "# Slide\n\n:::unknown\n\nContent")

    get presentation_path(presentation)

    assert_response :success
    assert_select '[aria-label="Markdown warnings"]', text: /directive/
    assert_select ".slide", text: /Content/
    refute_includes response.body, ":::unknown"
  end
end
