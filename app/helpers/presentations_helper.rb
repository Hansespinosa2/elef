module PresentationsHelper
  def render_markdown(markdown, work: @presentation)
    return Presentations::MarkdownRenderer.render(markdown) unless work&.id

    @media_resolvers ||= {}
    resolver = (@media_resolvers[work.object_id] ||= Presentations::MediaAssets.resolver_for(work))
    Presentations::MarkdownRenderer.render(markdown, media_resolver: resolver)
  end

  def render_editor_block(markdown, editor_block, work: @presentation)
    rendered = render_markdown(markdown, work: work)
    return rendered unless editor_block&.dig(:kind) == "image"

    alt = markdown.to_s.match(/\A\s*!\[([^\]]*)\]/)&.[](1).to_s
    content_tag(:figure, class: "editor-media") do
      safe_join([
        rendered,
        content_tag(:figcaption, alt, class: "editor-media-caption", aria: { label: "Editable image alt text" }, title: "Edit image alt text")
      ])
    end
  end

  def position_classes(position)
    return "" unless position

    "position-#{position.horizontal} position-#{position.vertical}"
  end

  def total_slides(presentation = nil)
    (presentation || @presentation)&.slides&.length || 0
  end

  def lineage_depth(presentation, seen = {})
    return 0 unless presentation.parent
    return 0 if seen[presentation.id]

    lineage_depth(presentation.parent, seen.merge(presentation.id => true)) + 1
  end
end
