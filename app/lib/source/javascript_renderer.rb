module Source
  module JavascriptRenderer
    BUNDLE_PATH = Rails.root.join("vendor/javascript/elef-renderer.bundle.js").freeze
    MAX_RENDER_BYTES = 50 * 1024 * 1024
    MAX_MEDIA_REFERENCES = 10_000
    CONTEXT_TIMEOUT_MS = 4_000
    CONTEXT_MAX_MEMORY = 256_000_000
    CONTEXT_KEY = :elef_javascript_renderer_context
    CONTEXT_PID_KEY = :elef_javascript_renderer_context_pid

    module_function

    def document_graph(documents)
      context.call("ElefRenderer.buildDocumentGraph", documents).deep_symbolize_keys
    end

    def document_link_tokens(source)
      context.call("ElefRenderer.extractDocumentLinkTokens", source.to_s)
        .map(&:deep_symbolize_keys)
    end

    def linkable_document_titles(titles)
      context.call("ElefRenderer.linkableDocumentTitles", Array(titles).map(&:to_s))
    end

    def render(markdown, media_resolver: nil, document_nodes: [], allow_remote_media: true)
      source = markdown.to_s
      raise ArgumentError, "Markdown source exceeds the renderer limit" if source.bytesize > MAX_RENDER_BYTES

      renderer = context
      media_map = resolved_media(renderer, source, media_resolver)
      renderer.call(
        "ElefRenderer.renderMarkdownBlock",
        source,
        {
          mediaMap: media_map,
          allowRemoteMedia: allow_remote_media,
          documentNodes: document_nodes
        }
      )
    end

    def editor_map(source, source_name:, mode:)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)
      raise ArgumentError, "Markdown source exceeds the renderer limit" if source.bytesize > MAX_RENDER_BYTES

      normalized_mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(normalized_mode)

      context.call(
        "ElefRenderer.buildEditorMap",
        source,
        { sourceName: source_name.to_s, mode: normalized_mode.to_s }
      ).deep_symbolize_keys
    end

    def work_structure(source, source_name:, mode:)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      normalized_mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(normalized_mode)

      context.call(
        "ElefRenderer.buildEditorStructure",
        source,
        { sourceName: source_name.to_s, mode: normalized_mode.to_s }
      ).deep_symbolize_keys
    end

    def read_style(source)
      context.call("ElefRenderer.readStyle", source.to_s).deep_symbolize_keys
    end

    def style_overrides(source)
      context.call("ElefRenderer.readStyleOverrides", source.to_s).deep_symbolize_keys
    end

    def normalize_theme_value(value)
      context.call("ElefRenderer.normalizeThemeValue", value.to_s)
    end

    def normalize_typography_value(value)
      context.call("ElefRenderer.normalizeTypographyValue", value.to_s)
    end

    def with_front_matter_value(source, key, value)
      context.call("ElefRenderer.withFrontMatterValue", source.to_s, key.to_s, value)
    end

    def portable_document_link_metadata(source)
      context.call("ElefRenderer.parsePortableDocumentLinks", source.to_s).deep_symbolize_keys
    end

    def first_heading(source)
      context.call("ElefRenderer.extractFirstMarkdownHeading", source.to_s)
    end

    def front_matter_has_key?(source, key)
      context.call("ElefRenderer.frontMatterHasKey", source.to_s, key.to_s)
    end

    def replace_first_heading(source, title)
      context.call("ElefRenderer.replaceFirstHeading", source.to_s, title.to_s)
    end

    def source_anchor_lines(source)
      context.call("ElefRenderer.sourceAnchorLines", source.to_s)
    end

    def editor_preview(
      source,
      kind:,
      title:,
      deck_id: "",
      media_resolver: nil,
      document_nodes: [],
      style: {},
      margin_settings: {},
      allow_remote_media: true
    )
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)
      raise ArgumentError, "Markdown source exceeds the renderer limit" if source.bytesize > MAX_RENDER_BYTES
      raise ArgumentError, "Unsupported document mode" unless %w[presentation document].include?(kind.to_s)
      raise ArgumentError, "Document links must be a list." unless document_nodes.is_a?(Array)

      renderer = context
      media_map = resolved_media(renderer, source, media_resolver)
      renderer.call(
        "ElefRenderer.renderPreview",
        {
          source: source,
          kind: kind.to_s,
          title: title.to_s,
          deckId: deck_id.to_s,
          documentNodes: document_nodes,
          mediaMap: media_map,
          allowRemoteMedia: allow_remote_media == true,
          style: style,
          marginSettings: margin_settings
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
      owner = Thread.current.thread_variable_get(CONTEXT_PID_KEY)
      if owner && owner != Process.pid
        raise "Inherited renderer context; dispose contexts before forking"
      end

      Thread.current.thread_variable_get(CONTEXT_KEY) || begin
        raise LoadError, "shared Elef renderer bundle is missing; run npm run renderer:build" unless BUNDLE_PATH.file?

        renderer = MiniRacer::Context.new(
          timeout: CONTEXT_TIMEOUT_MS,
          max_memory: CONTEXT_MAX_MEMORY,
          ensure_gc_after_idle: 60_000
        ).tap do |renderer|
          renderer.eval(BUNDLE_PATH.read, filename: "elef-renderer.bundle.js")
        end
        Thread.current.thread_variable_set(CONTEXT_KEY, renderer)
        Thread.current.thread_variable_set(CONTEXT_PID_KEY, Process.pid)
        renderer
      end
    end

    # Puma calls this in its quiescent master before starting worker processes.
    # Never call while another thread is evaluating JavaScript. MiniRacer's
    # single-threaded V8 platform requires both evaluation and disposal to be
    # finished before fork; a PID check alone cannot make an inherited V8 safe.
    def dispose_contexts_before_fork
      Thread.list.each do |thread|
        renderer = thread.thread_variable_get(CONTEXT_KEY)
        next unless renderer

        renderer.dispose
        thread.thread_variable_set(CONTEXT_KEY, nil)
        thread.thread_variable_set(CONTEXT_PID_KEY, nil)
      end
    end
  end
end
