module Source
  module EditorPreview
    module_function

    def render(work, source: work.source.to_s, title: work.title.to_s)
      workspace = work.workspace || Workspace.default
      document_nodes = ::Document.where(workspace: workspace)
        .includes(:document_aliases, :document_detail)
        .order(:title)
        .map do |document|
          {
            id: document.id.to_s,
            title: document.title,
            document_key: document.document_key,
            aliases: document.document_aliases.map(&:alias_name),
            href: Rails.application.routes.url_helpers.document_path(
              document,
              script_name: Rails.application.config.relative_url_root
            )
          }
        end

      JavascriptRenderer.render_preview(
        source,
        kind: work.work_type,
        title: title.presence || work.default_title,
        deck_id: work.id,
        media_resolver: WorkAssets.resolver_for(work),
        document_nodes: document_nodes,
        style: { theme: work.theme, typography: work.typography },
        allow_remote_media: true
      )
    end
  end
end
