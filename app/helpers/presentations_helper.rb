module PresentationsHelper
  def render_markdown(markdown, work: @presentation, art: false, host_mode: "fixed")
    return Source::Renderer.render_art_block(markdown, host_mode: host_mode) if art
    return Source::Renderer.render(markdown) unless work&.id

    @media_resolvers ||= {}
    resolver = (@media_resolvers[work.object_id] ||= WorkAssets.resolver_for(work))
    Source::Renderer.render(markdown, media_resolver: resolver)
  end

  def render_editor_block(markdown, editor_block, work: @presentation)
    rendered = render_markdown(markdown, work: work, art: !!editor_block&.dig(:art))
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

  def alignment_value(position)
    return "left" unless position
    return position.horizontal if position.vertical == "top"
    return position.horizontal unless position.vertical_explicit

    vertical = position.vertical == "middle" ? "center" : position.vertical
    "#{vertical} #{position.horizontal}"
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
