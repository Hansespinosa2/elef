require "test_helper"

class DocumentSampleDataTest < ActiveSupport::TestCase
  setup do
    Document.delete_all
  end

  test "loads the complete document sample catalog" do
    result = Documents::SampleData.load!
    records = result.records

    assert_equal Documents::SampleData::SAMPLES.length, records.length
    assert_empty result.conflicts
    assert_equal Documents::SampleData::SAMPLES.map { |sample| sample[:id] }, records.map(&:sample_id)
    assert_equal Documents::SampleData::SAMPLES.map { |sample| sample[:title] }, records.map(&:title)
    assert_equal Documents::SampleData::SAMPLES.map { |sample| sample[:source] }, records.map { |record| record.reload.source }
    assert Documents::SampleData::SAMPLES.all? { |sample| sample[:purpose].present? }
    assert records.all?(&:document?)
    assert_equal records.length, records.map(&:title).uniq.length
  end

  test "loads ten concise Elef design principles as a rendered document" do
    sample = Documents::SampleData::SAMPLES.find { |entry| entry[:id] == "document-design-principles" }
    assert sample

    headings = sample[:source].scan(/^## \d+\. (.+)$/).flatten
    assert_equal [
      "A movement made is a moment wasted",
      "A beautifully tall ceiling",
      "A gently rising floor",
      "Welcome in",
      "You see is what you get",
      "Idea to keyboard",
      "Keyboard to eyes",
      "Presentations are for you; Docs are for me",
      "Nothing good is lost",
      "Let polish earn its place"
    ], headings

    sections = sample[:source].split(/^## \d+\. /).drop(1)
    sections.each_with_index do |section, index|
      explanation = section.lines.drop(1).join(" ")
      assert_operator explanation.split.size, :<=, 100, "#{headings[index]} explanation should be at most 100 words"
    end

    document = Documents::SampleData.load!.records.find { |record| record.sample_id == sample[:id] }
    assert document
    assert_equal 10, document.preview_html.scan(/<h2(?:\s|>)/).length
  end

  test "reloads managed documents idempotently and preserves unrelated documents" do
    unrelated = Document.create!(title: "Personal notes", source: "# Keep me")

    assert_difference("Document.count", Documents::SampleData::SAMPLES.length) do
      Documents::SampleData.load!
    end

    managed = Document.find_by!(sample_id: "document-markdown-tour")
    managed.update!(title: "Changed fixture", source: "# Changed")

    assert_no_difference("Document.count") do
      Documents::SampleData.load!
    end

    assert_equal "Fixture: Markdown tour", managed.reload.title
    assert_equal Documents::SampleData::SAMPLES.first[:source], managed.source
    assert_equal ["Personal notes", "# Keep me"], [unrelated.reload.title, unrelated.source]
  end

  test "loads documents through the Rails seed entry point idempotently" do
    assert_difference("Document.count", Documents::SampleData::SAMPLES.length) do
      Rails.application.load_seed
    end

    assert_no_difference("Document.count") do
      Rails.application.load_seed
    end

    assert_equal Documents::SampleData::SAMPLES.length, Document.where.not(sample_id: nil).count
  end

  test "sample documents cover rendering and document graph behavior" do
    records = Documents::SampleData.load!.records
    documents = records.index_by(&:sample_id)

    components_html = documents.fetch("document-components").preview_html
    assert_includes components_html, "<table>"
    assert_includes components_html, "<pre><code"
    assert_includes components_html, "class=\"katex\""
    assert_includes components_html, 'src="https://example.com/elef-workflow.png"'

    positioned_html = documents.fetch("document-positioned-content").preview_html
    assert_includes positioned_html, "document-block position-left position-top"
    assert_includes positioned_html, "document-block position-center position-middle"
    assert_includes positioned_html, "document-block position-right position-bottom"
    refute_includes positioned_html, ":::align"

    boundaries_html = documents.fetch("document-boundaries").preview_html
    assert_includes boundaries_html, "<hr"
    assert_includes boundaries_html, "layout"
    assert_includes boundaries_html, "document"
    assert_includes boundaries_html, "---"

    warnings = documents.fetch("document-stress-warnings").preview_warnings
    assert_operator warnings.count { |warning| warning.include?("Unknown or malformed presentation directive") }, :>=, 3
    warnings_html = documents.fetch("document-stress-warnings").preview_html
    refute_includes warnings_html, "javascript:"
    assert_includes warnings_html, "document-link unresolved"

    graph = DocumentLinks::Graph.new(records).as_json
    assert_equal records.length, graph[:nodes].length
    coordinates = graph[:nodes].map { |node| [node[:x], node[:y]] }
    assert_equal coordinates.length, coordinates.uniq.length
    assert_includes graph[:edges], { source: documents.fetch("document-links-hub").id, target: documents.fetch("document-links-branch-a").id }
    assert_equal 1, graph[:edges].count { |edge| edge[:source] == documents.fetch("document-links-hub").id && edge[:target] == documents.fetch("document-links-branch-a").id }
    assert_includes graph[:edges], { source: documents.fetch("document-links-cycle-a").id, target: documents.fetch("document-links-cycle-b").id }
    assert_includes graph[:edges], { source: documents.fetch("document-links-cycle-b").id, target: documents.fetch("document-links-cycle-a").id }

    unresolved = documents.fetch("document-links-unresolved").id
    refute graph[:edges].any? { |edge| edge[:source] == unresolved && [documents.fetch("document-links-branch-a").id, documents.fetch("document-links-branch-b").id].include?(edge[:target]) }

    orphan = documents.fetch("document-links-orphan").id
    refute graph[:edges].any? { |edge| edge[:source] == orphan || edge[:target] == orphan }
  end

  test "includes a report-length fixture for long-form reading" do
    report = Documents::SampleData::SAMPLES.find { |sample| sample[:id] == "document-full-report" }

    assert report
    assert_operator report[:source].split.size, :>=, 4_000
    assert_operator report[:source].lines.count { |line| line.start_with?("## ") }, :>=, 10
    assert_includes report[:source], "## Appendix C: Glossary"
  end
end
