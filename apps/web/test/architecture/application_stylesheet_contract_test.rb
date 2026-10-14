require "test_helper"

class ApplicationStylesheetContractTest < ActiveSupport::TestCase
  APPLICATION_STYLESHEET_LAYOUTS = %w[
    app/views/layouts/application.html.erb
    app/views/layouts/presentation.html.erb
  ].freeze

  test "each application layout links the application stylesheet once" do
    APPLICATION_STYLESHEET_LAYOUTS.each do |path|
      source = Rails.root.join(path).read
      links = source.scan(/stylesheet_link_tag\b(.*?)(?=%>)/m).flatten.flat_map do |arguments|
        arguments.scan(/["']application["']/)
      end

      assert_equal 1, links.size, "#{path} must link application.css exactly once"
    end
  end

  test "the application stylesheet index uses digestable layered imports only" do
    source = Rails.root.join("app/assets/stylesheets/application.css").read
    imports = source.lines.grep(/^\s*@import\b/)
    index_rules = source.sub(%r{^/\*[\s\S]*?\*/\s*}, "").lines.reject { |line| line.strip.empty? }
    component_stylesheets = Rails.root.glob("app/assets/stylesheets/components/*.css")
      .map { |path| path.basename.to_s }
      .sort
    imported_component_stylesheets = imports.filter_map do |line|
      line.match(%r{@import url\("\./components/([^\"]+\.css)"\)})&.captures&.first
    end.sort

    assert_equal component_stylesheets, imported_component_stylesheets
    imports.each do |line|
      assert_match(/\A\s*@import url\("\.\/[^"\n]+\.css"\) layer\(elef-[a-z-]+\);\s*\z/, line)
    end

    assert_equal [
      "@layer elef-tokens, elef-base, elef-themes, elef-typography, elef-components, elef-utilities;",
      *imports.map(&:strip)
    ], index_rules.map(&:strip)
  end

  test "component styles consume theme tokens instead of branching on theme classes" do
    component_styles = Rails.root.glob("app/assets/stylesheets/components/*.css").map(&:read).join("\n")

    assert_no_match(/\.(?:work|document)-theme-(?:dark|light|match)\b/, component_styles)
  end
end
