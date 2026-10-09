require "test_helper"

class WorkSearchTest < ActiveSupport::TestCase
  setup do
    @workspace = Workspace.default
    @other_workspace = Workspace.create!(name: "Other", slug: "other-workspace-#{SecureRandom.hex(4)}")
  end

  test "returns empty array for blank or whitespace query" do
    assert_empty WorkSearch.call("", workspace: @workspace)
    assert_empty WorkSearch.call("   ", workspace: @workspace)
    assert_empty WorkSearch.call(nil, workspace: @workspace)
    assert_empty WorkSearch.call('""', workspace: @workspace)
  end

  test "finds works by title, alias, heading, and content" do
    doc_title = Document.create!(workspace: @workspace, title: "Quantum Computing Basics", source: "# Intro\n\nOverview")
    doc_alias = Document.create!(workspace: @workspace, title: "Complex Analysis", source: "# Functions\n\nDerivatives")
    doc_alias.document_aliases.create!(workspace: @workspace, alias_name: "residue-calculus")
    doc_heading = Document.create!(workspace: @workspace, title: "Physics Notes", source: "# Classical Mechanics\n\nMotion equations")
    doc_content = Document.create!(workspace: @workspace, title: "Lab Journal", source: "# Entry 1\n\nObserved extraordinary fluorescence under UV")

    title_results = WorkSearch.call("Quantum", workspace: @workspace)
    assert_equal 1, title_results.length
    assert_equal doc_title.id, title_results.first[:id]
    assert_equal "title", title_results.first[:matched_in]

    alias_results = WorkSearch.call("residue", workspace: @workspace)
    assert_equal 1, alias_results.length
    assert_equal doc_alias.id, alias_results.first[:id]
    assert_equal "alias", alias_results.first[:matched_in]

    heading_results = WorkSearch.call("Classical Mechanics", workspace: @workspace)
    assert_equal 1, heading_results.length
    assert_equal doc_heading.id, heading_results.first[:id]
    assert_equal "heading", heading_results.first[:matched_in]

    content_results = WorkSearch.call("fluorescence", workspace: @workspace)
    assert_equal 1, content_results.length
    assert_equal doc_content.id, content_results.first[:id]
    assert_equal "content", content_results.first[:matched_in]
    assert_includes content_results.first[:context], "fluorescence"
  end

  test "supports quoted phrase search and matches across line breaks" do
    doc = Document.create!(workspace: @workspace, title: "Survey Notes", source: "# Survey\n\nA memorable\nphrase from field research.")

    results = WorkSearch.call('"memorable phrase"', workspace: @workspace)
    assert_equal 1, results.length
    assert_equal doc.id, results.first[:id]
  end

  test "ignores diacritics and case when matching" do
    doc = Document.create!(workspace: @workspace, title: "Café au Lait Report", source: "# Résumé\n\nNotes from Zürich")

    assert_equal [doc.id], WorkSearch.call("cafe", workspace: @workspace).map { |r| r[:id] }
    assert_equal [doc.id], WorkSearch.call("resume", workspace: @workspace).map { |r| r[:id] }
    assert_equal [doc.id], WorkSearch.call("zurich", workspace: @workspace).map { |r| r[:id] }
    assert_equal [doc.id], WorkSearch.call("CAFÉ", workspace: @workspace).map { |r| r[:id] }
  end

  test "requires all clauses to match at least one field" do
    Document.create!(workspace: @workspace, title: "Alpha Beta", source: "# Gamma\n\nDelta")

    assert_equal 1, WorkSearch.call("Alpha Delta", workspace: @workspace).length
    assert_empty WorkSearch.call("Alpha Epsilon", workspace: @workspace)
  end

  test "ranks title matches higher than aliases, headings, and content" do
    doc_content = Document.create!(workspace: @workspace, title: "General Notes", source: "# Section\n\nRankTerm here")
    doc_heading = Document.create!(workspace: @workspace, title: "Outline", source: "# RankTerm\n\nBody")
    doc_alias = Document.create!(workspace: @workspace, title: "Reference Sheet", source: "# Ref\n\nBody")
    doc_alias.document_aliases.create!(workspace: @workspace, alias_name: "RankTerm")
    doc_title = Document.create!(workspace: @workspace, title: "RankTerm Guide", source: "# Details\n\nBody")

    results = WorkSearch.call("RankTerm", workspace: @workspace)
    assert_equal [doc_title.id, doc_alias.id, doc_heading.id, doc_content.id], results.map { |r| r[:id] }
    assert_operator results[0][:score], :>, results[1][:score]
    assert_operator results[1][:score], :>, results[2][:score]
    assert_operator results[2][:score], :>, results[3][:score]
  end

  test "filters by work type using singular or plural names" do
    doc = Document.create!(workspace: @workspace, title: "Shared Topic Doc", source: "# Source\n\nContent")
    pres = Presentation.create!(workspace: @workspace, title: "Shared Topic Deck", source: "# Source\n\nContent")

    assert_equal 2, WorkSearch.call("Shared Topic", workspace: @workspace).length
    assert_equal [doc.id], WorkSearch.call("Shared Topic", workspace: @workspace, type: "document").map { |r| r[:id] }
    assert_equal [doc.id], WorkSearch.call("Shared Topic", workspace: @workspace, type: "documents").map { |r| r[:id] }
    assert_equal [pres.id], WorkSearch.call("Shared Topic", workspace: @workspace, type: "presentation").map { |r| r[:id] }
    assert_equal [pres.id], WorkSearch.call("Shared Topic", workspace: @workspace, type: "presentations").map { |r| r[:id] }
    assert_equal 2, WorkSearch.call("Shared Topic", workspace: @workspace, type: "unknown").length
  end

  test "clamps limit to valid bounds and respects default limit" do
    35.times do |i|
      Document.create!(workspace: @workspace, title: "Batch Document #{i}", source: "# Source\n\nCommonKeyword")
    end

    default_results = WorkSearch.call("CommonKeyword", workspace: @workspace)
    assert_equal WorkSearch::DEFAULT_LIMIT, default_results.length

    max_results = WorkSearch.call("CommonKeyword", workspace: @workspace, limit: 100)
    assert_equal WorkSearch::MAX_LIMIT, max_results.length

    min_results = WorkSearch.call("CommonKeyword", workspace: @workspace, limit: 0)
    assert_equal 1, min_results.length
  end

  test "isolates search results to the requested workspace" do
    doc1 = Document.create!(workspace: @workspace, title: "Private Secret", source: "# Secret")
    doc2 = Document.create!(workspace: @other_workspace, title: "Private Secret", source: "# Secret")

    results1 = WorkSearch.call("Private Secret", workspace: @workspace)
    assert_equal [doc1.id], results1.map { |r| r[:id] }

    results2 = WorkSearch.call("Private Secret", workspace: @other_workspace)
    assert_equal [doc2.id], results2.map { |r| r[:id] }
  end

  test "formats context with leading and trailing ellipses when match is surrounded by text" do
    long_prefix = "The quick brown fox jumps over the lazy dog. " * 3
    long_suffix = " More trailing details follow at the end of the text." * 3
    doc = Document.create!(workspace: @workspace, title: "Padded", source: "# Doc\n\n#{long_prefix}UniqueAnchor#{long_suffix}")

    results = WorkSearch.call("UniqueAnchor", workspace: @workspace)
    assert_equal 1, results.length
    context = results.first[:context]
    assert context.start_with?("…")
    assert context.end_with?("…")
    assert_includes context, "UniqueAnchor"
  end
end
