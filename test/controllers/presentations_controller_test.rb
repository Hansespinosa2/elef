require "test_helper"
require "tempfile"

class PresentationsControllerTest < ActionDispatch::IntegrationTest
  test "rename preserves the all-library view and rejects arbitrary destinations" do
    work = presentations(:one)
    get root_path
    assert_select "form[action='#{rename_presentation_path(work)}'] input[name='library_view'][value='all']"
    patch rename_presentation_path(work), params: { library_view: "all", presentation: { title: "Renamed" } }
    assert_redirected_to root_path
    patch rename_presentation_path(work), params: { library_view: "https://example.invalid/", presentation: { title: "Again" } }
    assert_redirected_to presentations_path
  end

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
    source = "---\ntheme: dark\ntypography: technical\n---\n# Initial"
    server_source = "---\ntheme: dark\ntypography: technical\n---\n# Server"
    presentation = Presentation.create!(title: "Concurrent", source: source)
    lock_version = presentation.lock_version
    base_revision = presentation.revision_token

    patch presentation_path(presentation), params: {
      presentation: { source: server_source, lock_version: lock_version, base_revision: base_revision }
    }, as: :json
    assert_response :ok

    patch presentation_path(presentation), params: {
      presentation: { source: "# Local", lock_version: lock_version, base_revision: base_revision }
    }, as: :json

    assert_response :conflict
    assert_equal "conflict", response.parsed_body["status"]
    assert_predicate response.parsed_body["recovery_revision_id"], :present?
    assert_equal "# Local", response.parsed_body.dig("recovery_revision", "source")
    assert_equal server_source, presentation.reload.source
    assert_equal "dark", response.parsed_body.dig("current", "theme")
    assert_equal "technical", response.parsed_body.dig("current", "typography")
  end

  test "invalid HTML draft saves re-render the edit form instead of redirecting" do
    presentation = presentations(:one)
    source = presentation.source

    patch presentation_path(presentation), params: {
      presentation: { title: "x" * 121, source: "# Rejected" }
    }

    assert_response :unprocessable_content
    assert_select "form[action='#{presentation_path(presentation)}']"
    assert_equal source, presentation.reload.source
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
    assert_select "form.visual-editor-form"
    assert_select "form[action='#{publish_presentation_path(presentations(:one))}'] button.button", text: "Present"
    assert_select 'form.visual-editor-form form', count: 0
    assert_select '[data-editor-view-config]'
    assert_select '[data-editor-form-controllers*="autosave"][data-editor-form-controllers*="preview"]'
    config = editor_host_config
    assert_equal "presentation", config.fetch("kind")
    assert_equal "presentation[source]", config.fetch("sourceName")
    assert_equal "presentation[theme]", config.fetch("themeName")
    assert_equal "presentation[typography]", config.fetch("typographyName")
    assert config.fetch("persisted")
    assert_select 'button[data-dirty-navigation]', text: "Present"
    assert_select "a[href='#{print_presentation_path(presentations(:one))}']", text: "Print draft / save PDF"
    get new_presentation_path
    assert_select 'form.visual-editor-form[data-autosave-save-enabled-value="false"]'
    config = editor_host_config
    assert_equal Presentation::DEFAULT_SOURCE, config.fetch("source")
    refute config.fetch("persisted")
    assert_select 'form[data-preview-url-value="/presentations/preview"]'
    assert_select '[data-editor-form-controllers*="slide-overview"][data-editor-form-controllers*="media"]'
    assert_equal "presentation", config.fetch("kind")
    assert_equal 1, config.fetch("slideCount")
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
    assert_equal presentation.reload.lock_version, response.parsed_body["lock_version"]
    blob = presentation.assets.blobs.last
    assert_equal digest, blob.metadata["elef_sha256"]
    assert blob.analyzed?

    presentation.reload.update!(source: "# Pixel\n\n#{response.parsed_body["source"]}")
    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-media-cover[src='/presentations/#{presentation.id}/assets/#{digest}'][alt='Pixel']"

    get media_asset_presentation_path(presentation, digest)
    assert_response :success
    assert_equal "image/png", response.media_type
    assert_equal bytes, response.body.b

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

  test "Present receives reveal counts while print keeps every event on one slide" do
    presentation = Presentation.create!(title: "Reveal print", source: "# One slide\n\n:::step{1}\nFirst event\n\n:::step{1}\nTogether\n\n:::step{2}\nLast event")

    get present_presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-slide[data-elef-reveal-event-count='2']"
    assert_select ".presentation-slide .slide-block[data-elef-reveal-event='0']", count: 2
    assert_select ".presentation-slide .slide-block[data-elef-reveal-event='1']", count: 1

    get print_presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-print-slides > .slide-frame", count: 1
    assert_select ".presentation-print .slide-block.is-presentation-reveal-hidden, .presentation-print .slide-block[inert], .presentation-print .slide-block[aria-hidden='true']", count: 0
    assert_select ".presentation-print .slide-block[data-elef-reveal-event='0']", count: 2
    assert_select ".presentation-print .slide-block[data-elef-reveal-event='1']", count: 1
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

  test "new presentations can export their unsaved form values without persistence" do
    presentation_count = Presentation.count

    post pptx_presentations_path(version: "draft"), params: {
      presentation: {
        title: "Unsaved new deck",
        source: "# Unsaved new slide\n\nDraft body.",
        theme: "dark",
        typography: "technical"
      }
    }, as: :json

    assert_response :success
    payload = response.parsed_body
    assert_equal "Unsaved new deck.pptx", payload["filename"]
    assert_equal "dark", payload.dig("presentation", "theme")
    assert_equal "technical", payload.dig("presentation", "typography")
    assert_includes payload.dig("slides", 0, "blocks", 1, "html"), "Draft body."
    assert_equal presentation_count, Presentation.count
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
    assert_includes html, "/presentations/#{presentation.id}/pptx_assets/#{digest}?"
    assert_match(/(?:\?|&amp;)version=published(?:&amp;|")/, html)
    assert_match(/(?:\?|&amp;)release_id=#{release_id}(?:&amp;|")/, html)

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

    get new_presentation_path
    assert_select '[data-controller="pptx-export"][data-pptx-export-url-value=?][data-pptx-export-current-draft-value="true"]',
      pptx_presentations_path(version: "draft") do
      assert_select "button", text: "Download PPTX draft"
    end
    assert_select '[data-pptx-export-library-url-value="/vendor/pptxgen.bundle.js"]'

    get new_presentation_path, headers: { "SCRIPT_NAME" => "/apps/elef/dev" }
    assert_select '[data-pptx-export-library-url-value="/apps/elef/dev/vendor/pptxgen.bundle.js"]'
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
    assert_equal "presentation", response.parsed_body.dig("editor_map", "mode")
    assert_equal 2, response.parsed_body.dig("editor_map", "slides").length
  end

  test "editor preview returns editable projections without changing saved output routes" do
    presentation = Presentation.create!(title: "Editable deck", source: "# First\n\nBody")

    post preview_presentation_path(presentation), params: {
      presentation: { source: "# Draft\n\nBody\n\n![Diagram](/diagram.svg)" }, projection: "editor", revision: "editor-1"
    }, as: :json

    assert_response :success
    assert_includes response.parsed_body["html"], 'contenteditable="true"'
    assert_includes response.parsed_body["html"], 'class="editor-media-caption"'
    assert_includes response.parsed_body["html"], 'src="/diagram.svg"'
    assert_equal "editor-1", response.parsed_body["revision"]
    assert_equal "# First\n\nBody", presentation.reload.source

    get presentation_path(presentation)

    assert_response :success
    assert_select '[contenteditable="true"]', count: 0
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

    get presentations_path
    assert_select "form[action='#{load_samples_presentations_path}'] button", text: "Load sample presentations"

    expected_seed_records = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_seed_records) do
      post load_samples_presentations_path
    end
    assert_redirected_to presentations_path
    assert_equal "Sample presentations loaded.", flash[:notice]
    follow_redirect!
    (Presentations::SampleData::SAMPLES + Presentations::LineageSampleData::SAMPLES).each do |sample|
      assert_select ".library-card-title", text: sample[:title]
    end

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

  test "renders inferred layouts and positioned blocks in the saved preview" do
    presentation = Presentation.create!(title: "Automatic layouts", source: <<~MARKDOWN)
      :::align{top right}
      # Compare

      ## Left

      One side.

      ## Right

      The other side.
      ---
      # Positioned

      :::align{center center}

      Center this message.
    MARKDOWN

    get presentation_path(presentation)

    assert_response :success
    assert_select ".slide-two-column .slide-regions"
    assert_select ".slide-two-column .slide-title.slide-block.position-right.position-top", text: "Compare"
    assert_select ".slide-statement .position-center.position-middle", text: /Center this message/
    assert_no_match /:::align/, response.body
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
    assert_equal "presentation[typography]", editor_host_config.fetch("typographyName")
    assert_equal "presentation", editor_host_config.fetch("kind")
  end

  private

  def editor_host_config
    host = css_select("[data-editor-view-config]").first
    assert host, "expected the shared editor host"
    JSON.parse(host["data-editor-view-config"])
  end

  test "renders positioning warnings without leaking directives" do
    presentation = Presentation.create!(title: "Warnings", source: "# Slide\n\n:::unknown\n\nContent")

    get presentation_path(presentation)

    assert_response :success
    assert_select '[aria-label="Markdown warnings"]', text: /directive/
    assert_select ".slide", text: /Content/
    refute_includes response.body, ":::unknown"
  end

  test "create responds to JSON format with edit and upload urls" do
    post presentations_path, params: { presentation: { title: "JSON Deck", source: "# New Deck" } }, headers: { "Accept" => "application/json" }

    assert_response :created
    json = response.parsed_body
    assert json["id"]
    assert_equal edit_presentation_path(json["id"]), json["edit_url"]
    assert_equal upload_asset_presentation_path(json["id"]), json["upload_url"]
  end

  test "rejects image and video uploads over the 50 MB media limit" do
    presentation = Presentation.create!(title: "Oversized media", source: "# Media")

    Tempfile.create(["huge", ".png"]) do |file|
      file.truncate(50.megabytes + 1)
      upload = Rack::Test::UploadedFile.new(file.path, "image/png")
      post upload_asset_presentation_path(presentation), params: { file: upload }, headers: { "Accept" => "application/json" }
    end
    assert_response :unprocessable_content
    assert_equal "Media files must be 50 MB or smaller.", response.parsed_body["error"]

    Tempfile.create(["huge", ".mp4"]) do |file|
      file.truncate(50.megabytes + 1)
      upload = Rack::Test::UploadedFile.new(file.path, "video/mp4")
      post upload_asset_presentation_path(presentation), params: { file: upload }, headers: { "Accept" => "application/json" }
    end
    assert_response :unprocessable_content
    assert_equal "Media files must be 50 MB or smaller.", response.parsed_body["error"]

    assert_empty presentation.assets.reload
  end

  test "history lists revisions newest first with their payload fields" do
    presentation = Presentation.create!(title: "History deck", source: "# First")
    later = presentation.work_revisions.create!(
      workspace: presentation.workspace,
      source: "# Second",
      source_digest: WorkRevision.digest("# Second"),
      reason: "checkpoint",
      status: "checkpoint"
    )

    get history_presentation_path(presentation)

    assert_response :success
    json = response.parsed_body
    assert_equal [later.id, presentation.work_revisions.order(:id).first.id], json.map { |entry| entry["id"] }
    assert_equal %w[created_at id reason source source_digest status].sort, json.first.keys.sort
    assert_equal "# Second", json.first["source"]
    assert_equal WorkRevision.digest("# Second"), json.first["source_digest"]
    assert_equal "checkpoint", json.first["reason"]
    assert_equal "checkpoint", json.first["status"]
    assert json.first["created_at"].present?
  end

  test "restore reinstates a chosen revision and reports the restored draft" do
    presentation = Presentation.create!(title: "Restore deck", source: "# First")
    presentation.update!(source: "# Second")
    original = presentation.work_revisions.order(:id).first

    post restore_presentation_path(presentation), params: { revision_id: original.id }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "Revision restored.", flash[:notice]
    assert_equal "# First", presentation.reload.source

    presentation.update!(source: "# Third")
    post restore_presentation_path(presentation), params: { revision_id: original.id }, as: :json

    assert_response :ok
    assert_equal "# First", response.parsed_body["source"]
    assert_equal "saved", response.parsed_body["status"]
    assert_equal "restore", response.parsed_body.dig("latest_checkpoint", "reason")
    assert_equal "# First", presentation.reload.source
  end

  test "media_asset serves assets by filename and relative path as well as digest" do
    presentation = Presentation.create!(title: "Asset routing deck", source: "# Asset Deck")
    bytes = "image bytes".b
    presentation.assets.attach(io: StringIO.new(bytes), filename: "diagram.png", content_type: "image/png")
    digest = Digest::SHA256.hexdigest(bytes)
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))

    # Request by digest
    get media_asset_presentation_path(presentation, digest)
    assert_response :success
    assert_equal bytes, response.body.b

    # Request by filename
    get media_asset_presentation_path(presentation, "diagram.png")
    assert_response :success
    assert_equal bytes, response.body.b

    # Request by relative path
    get media_asset_presentation_path(presentation, "assets/diagram.png")
    assert_response :success
    assert_equal bytes, response.body.b
  end
end
