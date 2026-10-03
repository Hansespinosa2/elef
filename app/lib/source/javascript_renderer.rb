module Source
  module JavascriptRenderer
    BUNDLE_PATH = Rails.root.join("vendor/javascript/elef-renderer.bundle.js").freeze
    MAX_RENDER_BYTES = 50 * 1024 * 1024
    MAX_MEDIA_REFERENCES = 10_000
    CONTEXT_TIMEOUT_MS = 4_000
    CONTEXT_MAX_MEMORY = 256_000_000
    CONTEXT_KEY = :elef_javascript_renderer_context

    module_function

    def render(markdown, media_resolver: nil, allow_remote_media: true)
      source = markdown.to_s
      raise ArgumentError, "Markdown source exceeds the renderer limit" if source.bytesize > MAX_RENDER_BYTES

      renderer = context
      media_map = resolved_media(renderer, source, media_resolver)
      renderer.call(
        "ElefRenderer.renderMarkdownBlock",
        source,
        {
          mediaMap: media_map,
          allowRemoteMedia: allow_remote_media
        }
      )
    end

    def editor_map(source, source_name:, mode:)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      normalized_mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(normalized_mode)

      context.call(
        "ElefRenderer.buildEditorMap",
        source,
        { sourceName: source_name.to_s, mode: normalized_mode.to_s }
      ).deep_symbolize_keys
    end

    def render_preview(source, kind:, title:, deck_id: nil, media_resolver: nil, document_nodes: [], style: {}, allow_remote_media: false)
      raise ArgumentError, "Markdown source must be plain text" unless source.is_a?(String)
      raise ArgumentError, "Markdown source exceeds the renderer limit" if source.bytesize > MAX_RENDER_BYTES

      normalized_kind = kind.to_s
      raise ArgumentError, "Unsupported document mode" unless %w[presentation document].include?(normalized_kind)
      raise ArgumentError, "Document links must be an array" unless document_nodes.is_a?(Array)

      renderer = context
      renderer.call(
        "ElefRenderer.renderPreview",
        {
          source: source,
          kind: normalized_kind,
          title: title.to_s,
          deckId: deck_id.to_s,
          mediaMap: resolved_media(renderer, source, media_resolver),
          allowRemoteMedia: allow_remote_media == true,
          documentNodes: document_nodes,
          style: style
        }
      ).deep_symbolize_keys
    end

    def resolved_media(renderer, source, media_resolver)
      return {} unless media_resolver && source.include?("!")

      renderer.call("ElefRenderer.collectMediaReferences", source)
        .first(MAX_MEDIA_REFERENCES)
        .each_with_object({}) do |reference, entries|
          identifier = reference.match?(/\Aelef-asset:[0-9a-f]{64}\z/i) ? reference.delete_prefix("elef-asset:") : reference
          media = media_resolver.call(identifier)
          next unless media.is_a?(Array) && media.length >= 2 && media[0].present?

          entries[reference] = { src: media[0].to_s, contentType: media[1].to_s }
        rescue StandardError
          raise if reference.match?(/\Aelef-asset:[0-9a-f]{64}\z/i)

          next
        end
    end

    def context
      Thread.current.thread_variable_get(CONTEXT_KEY) || begin
        raise LoadError, "shared Elef renderer bundle is missing; run npm run build --prefix desktop/frontend" unless BUNDLE_PATH.file?

        renderer = MiniRacer::Context.new(
          timeout: CONTEXT_TIMEOUT_MS,
          max_memory: CONTEXT_MAX_MEMORY,
          ensure_gc_after_idle: 60_000
        ).tap do |renderer|
          renderer.eval(BUNDLE_PATH.read, filename: "elef-renderer.bundle.js")
        end
        Thread.current.thread_variable_set(CONTEXT_KEY, renderer)
        renderer
      end
    end
  end
end
