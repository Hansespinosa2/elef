require "json"
require "zip"

module WorkPackage
  class Exporter
    def self.call(work, include_revisions: false)
      new(work, include_revisions: include_revisions).call
    end

    def initialize(work, include_revisions: false)
      @work = work
      @include_revisions = include_revisions
    end

    def call
      manifest = manifest_payload
      buffer = Zip::OutputStream.write_buffer do |zip|
        write_entry(zip, "source.md", @work.source.to_s)
        if @work.presentation?
          write_entry(zip, "presentation.md", Presentations::MediaAssets.portable_markdown(@work.source.to_s, @work))
        end
        write_entry(zip, "manifest.json", JSON.pretty_generate(manifest))
        write_entry(zip, "metadata.json", JSON.pretty_generate(metadata_payload))
        @work.assets.each do |asset|
          filename = asset.blob.filename.to_s
          clean_filename = sanitize_filename(filename)
          legacy_path = "assets/#{asset.blob.key}-#{clean_filename}"
          write_entry(zip, legacy_path, asset.blob.download)
          portable_path = "assets/#{clean_filename}"
          write_entry(zip, portable_path, asset.blob.download) if portable_path != legacy_path
        end
        if @include_revisions
          @work.work_revisions.history.each do |revision|
            write_entry(zip, "revisions/#{revision.id}.md", revision.source.to_s)
          end
        end
        if @work.published_release
          write_entry(zip, "release/source.md", @work.published_release.source_revision.source.to_s)
          if @work.published_release.rendered_artifact.present?
            write_entry(zip, "release/artifact.html", @work.published_release.rendered_artifact)
          end
        end
      end
      buffer.string
    end

    private

    def manifest_payload
      {
        "schema_version" => 1,
        "work" => {
          "id" => @work.id,
          "kind" => @work.kind,
          "title" => @work.title,
          "workspace_id" => @work.workspace_id,
          "document_key" => @work.respond_to?(:document_key) ? @work.document_key : nil,
          "draft_digest" => @work.draft_digest,
          "revision_token" => @work.revision_token
        },
        "latest_checkpoint" => revision_payload(@work.latest_checkpoint),
        "published_release" => release_payload(@work.published_release),
        "assets" => @work.assets.map { |asset| asset_payload(asset) },
        "revisions" => @include_revisions ? @work.work_revisions.history.map { |revision| revision_payload(revision) } : []
      }
    end

    def metadata_payload
      metadata = { "kind" => @work.kind, "title" => @work.title, "workspace" => @work.workspace.slice(:id, :name, :slug) }
      if @work.document?
        metadata["document"] = {
          "document_key" => @work.document_key,
          "aliases" => @work.aliases.map(&:alias_name)
        }
      else
        metadata["presentation"] = {
          "settings" => @work.presentation_detail&.settings || {},
          "sample_id" => @work.sample_id,
          "lineage" => lineage_payload
        }
      end
      metadata
    end

    def revision_payload(revision)
      return nil unless revision

      {
        "id" => revision.id,
        "source_digest" => revision.source_digest,
        "reason" => revision.reason,
        "status" => revision.status,
        "edit_session_id" => revision.edit_session_id,
        "parent_source_digest" => revision.parent_revision&.source_digest,
        "base_source_digest" => revision.base_revision&.source_digest,
        "created_at" => revision.created_at&.iso8601
      }
    end

    def release_payload(release)
      return nil unless release

      {
        "id" => release.id,
        "source_revision_id" => release.source_revision_id,
        "source_digest" => release.source_digest,
        "renderer_version" => release.renderer_version,
        "settings" => release.settings,
        "asset_manifest" => release.asset_manifest,
        "render_digest" => release.render_digest,
        "rendered_artifact" => release.rendered_artifact,
        "published_at" => release.published_at&.iso8601
      }
    end

    def asset_payload(asset)
      blob = asset.blob
      {
        "id" => blob.id,
        "key" => blob.key,
        "filename" => blob.filename.to_s,
        "content_type" => blob.content_type,
        "byte_size" => blob.byte_size,
        "checksum" => blob.checksum,
        "sha256" => Presentations::MediaAssets.digest(blob),
        "path" => "assets/#{blob.key}-#{sanitize_filename(blob.filename.to_s)}"
      }
    end

    def lineage_payload
      edge = @work.respond_to?(:lineage_edge) ? @work.lineage_edge : nil
      return nil unless edge

      {
        "parent_work_id" => edge.parent_work_id,
        "parent_title" => edge.parent_title_snapshot,
        "parent_current_title" => edge.parent_work&.title,
        "fork_type" => edge.fork_type,
        "origin_revision_id" => edge.origin_revision_id,
        "origin_source_digest" => edge.origin_revision&.source_digest,
        "origin_source" => edge.origin_source_snapshot.presence || edge.origin_revision&.source
      }
    end

    def write_entry(zip, path, body)
      zip.put_next_entry(path)
      zip.write(body.to_s)
    end

    def sanitize_filename(filename)
      filename.gsub(/[^a-zA-Z0-9_.-]/, "_")
    end
  end
end
