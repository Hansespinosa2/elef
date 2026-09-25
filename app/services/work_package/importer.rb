require "digest"
require "json"
require "stringio"
require "zip"

module WorkPackage
  class ImportConflict < StandardError; end

  class Importer
    def self.call(package, workspace: Workspace.default)
      new(package, workspace: workspace).call
    end

    def initialize(package, workspace:)
      @package = package
      @workspace = workspace
    end

    def call
      entries = read_entries
      manifest = JSON.parse(entries.fetch("manifest.json"))
      metadata = JSON.parse(entries.fetch("metadata.json"))
      work_data = manifest.fetch("work")
      ensure_does_not_replace_existing!(work_data, metadata)

      work = build_work(work_data, entries.fetch("source.md"))
      Work.transaction do
        work.save!
        import_details(work, metadata)
        import_revisions(work, manifest, entries)
      end
      import_assets(work, manifest, entries)
      work.reload
      Work.transaction do
        import_release(work, manifest, entries)
        import_aliases(work, metadata)
        import_lineage(work, metadata)
      end
      work.reload
    rescue StandardError
      work&.reload&.destroy! if work&.persisted?
      raise
    end

    private

    def read_entries
      source = @package.respond_to?(:read) ? @package.read : File.binread(@package)
      entries = {}
      Zip::File.open_buffer(source) do |zip|
        zip.each { |entry| entries[entry.name] = entry.get_input_stream.read }
      end
      entries
    end

    def ensure_does_not_replace_existing!(work_data, metadata)
      if work_data["document_key"].present? && DocumentDetail.exists?(document_key: work_data["document_key"])
        raise ImportConflict, "A document with this stable identity already exists"
      end
      if work_data["kind"] == "document" && Work.documents.exists?(workspace: @workspace, title: work_data["title"])
        raise ImportConflict, "A document with this title already exists in this workspace"
      end
      sample_id = metadata.dig("presentation", "sample_id")
      if sample_id.present? && PresentationDetail.exists?(sample_id: sample_id)
        raise ImportConflict, "A presentation with sample id #{sample_id} already exists"
      end
      if metadata.dig("document", "aliases").to_a.any? { |name| DocumentAlias.exists?(workspace: @workspace, alias_name: name) }
        raise ImportConflict, "One of the document aliases already exists in this workspace"
      end
    end

    def build_work(work_data, source)
      klass = work_data["kind"] == "document" ? Document : Presentation
      work = klass.new(
        workspace: @workspace,
        title: work_data["title"],
        source: source
      )
      work.set_initial_revision_metadata(reason: "import", metadata: { imported_work_id: work_data["id"] })
      work
    end

    def import_revisions(work, manifest, entries)
      @revisions_by_digest = { work.latest_checkpoint.source_digest => work.latest_checkpoint }
      revisions = manifest.fetch("revisions", [])
      revisions.reverse_each do |data|
        source = entries["revisions/#{data["id"]}.md"]
        next unless source

        existing = work.work_revisions.find_by(source_digest: WorkRevision.digest(source))
        if existing
          @revisions_by_digest[existing.source_digest] = existing
          next
        end

        parent_revision = if data.key?("parent_source_digest")
          @revisions_by_digest[data["parent_source_digest"]]
        else
          work.latest_checkpoint
        end
        base_revision = @revisions_by_digest[data["base_source_digest"]]

        revision = work.work_revisions.create!(
          workspace: @workspace,
          parent_revision: parent_revision,
          base_revision: base_revision,
          source: source,
          source_digest: WorkRevision.digest(source),
          reason: WorkRevision::REASONS.include?(data["reason"]) ? data["reason"] : "import",
          status: %w[recovery restore fork-origin].include?(data["status"]) ? data["status"] : "checkpoint",
          edit_session_id: data["edit_session_id"],
          metadata: { imported_revision_id: data["id"] }
        )
        @revisions_by_digest[revision.source_digest] = revision
      end
      latest_digest = manifest.dig("latest_checkpoint", "source_digest")
      latest = @revisions_by_digest[latest_digest] || work.latest_checkpoint
      work.update_columns(latest_checkpoint_id: latest.id) if latest
    end

    def import_details(work, metadata)
      if work.document?
        document = metadata.fetch("document", {})
        key = document["document_key"].presence
        work.document_detail.update!(document_key: key) if key
        return
      end

      data = metadata.fetch("presentation", {})
      detail = work.presentation_detail
      detail.update!(
        settings: data["settings"] || {},
        sample_id: data["sample_id"].presence
      )
      work.update_columns(sample_id: detail.sample_id) if work.has_attribute?(:sample_id)
    end

    def import_aliases(work, metadata)
      return unless work.document?

      work.document_aliases.delete_all
      metadata.dig("document", "aliases").to_a.each do |alias_name|
        DocumentAlias.create!(workspace: @workspace, work: work, alias_name: alias_name)
      end
    end

    def import_assets(work, manifest, entries)
      @asset_blobs_by_key = {}
      manifest.fetch("assets", []).each do |asset|
        path = asset.fetch("path")
        filename = asset.fetch("filename")
        clean_filename = filename.to_s.gsub(/[^a-zA-Z0-9_.-]/, "_")
        content = entries[path] || entries["assets/#{filename}"] || entries["assets/#{clean_filename}"]
        next unless content

        work.reload.assets.attach(
          io: StringIO.new(content),
          filename: filename,
          content_type: asset["content_type"]
        )
        blob = work.assets.attachments.last&.blob
        if blob
          digest = Presentations::MediaAssets.digest(blob)
          expected_digest = asset["sha256"].presence
          if expected_digest.present? && expected_digest != digest
            raise ArgumentError, "Work package asset digest does not match its contents"
          end
          blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
        end
        @asset_blobs_by_key[asset["key"].to_s] = blob if blob
        @asset_blobs_by_key[asset["id"].to_s] = blob if blob
      end
      Presentations::FolderSync.sync!(work) if work.presentation?
    end

    def import_release(work, manifest, entries)
      return unless work.presentation?
      release_data = manifest["published_release"]
      return unless release_data

      source = entries["release/source.md"]
      revision = if source
        ensure_revision(work, source, reason: "publish")
      else
        work.work_revisions.find_by(source_digest: release_data["source_digest"]) || work.latest_checkpoint
      end
      return unless revision

      settings = release_data["settings"] || {}
      asset_manifest = remap_asset_manifest(release_data["asset_manifest"] || [])
      render_digest = Digest::SHA256.hexdigest(
        [revision.source_digest, release_data["renderer_version"].presence || PresentationRelease::RENDERER_VERSION,
         JSON.generate(settings), JSON.generate(asset_manifest)].join("\0")
      )

      release = PresentationRelease.create!(
        work: work,
        source_revision: revision,
        source_digest: revision.source_digest,
        renderer_version: release_data["renderer_version"].presence || PresentationRelease::RENDERER_VERSION,
        settings: settings,
        asset_manifest: asset_manifest,
        render_digest: render_digest,
        rendered_artifact: entries["release/artifact.html"],
        published_at: release_data["published_at"].presence || Time.current
      )
      work.update_columns(published_release_id: release.id)
    end

    def import_lineage(work, metadata)
      return unless work.presentation?
      lineage = metadata.dig("presentation", "lineage")
      return unless lineage

      parent = find_lineage_parent(lineage)
      origin = if parent && lineage["origin_source_digest"].present?
        parent.work_revisions.find_by(source_digest: lineage["origin_source_digest"])
      elsif parent && lineage["origin_source"].present?
        parent.work_revisions.find_by(source_digest: WorkRevision.digest(lineage["origin_source"]))
      end
      PresentationLineageEdge.create!(
        parent_work: parent,
        child_work: work,
        origin_revision: origin,
        fork_type: PresentationLineageEdge::FORK_TYPES.include?(lineage["fork_type"]) ? lineage["fork_type"] : "inspiration",
        parent_title_snapshot: lineage["parent_title"].presence || lineage["parent_current_title"],
        origin_source_snapshot: lineage["origin_source"]
      )
    end

    def find_lineage_parent(lineage)
      candidates = @workspace.works.where(kind: "presentation")
      origin_digest = lineage["origin_source_digest"].presence
      origin_source = lineage["origin_source"].presence

      candidate = candidates.find_by(id: lineage["parent_work_id"]) if lineage["parent_work_id"].present?
      return candidate if candidate && lineage_matches_parent?(candidate, origin_digest, origin_source)

      titles = [lineage["parent_title"], lineage["parent_current_title"]].compact_blank.uniq
      matching = candidates.where(title: titles).select do |work|
        lineage_matches_parent?(work, origin_digest, origin_source)
      end
      matching.one? ? matching.first : nil
    end

    def lineage_matches_parent?(work, origin_digest, origin_source)
      return work.source == origin_source if origin_digest.blank? && origin_source.present?
      return false if origin_digest.blank?

      work.work_revisions.exists?(source_digest: origin_digest)
    end

    def remap_asset_manifest(asset_manifest)
      Array(asset_manifest).map do |entry|
        asset = entry.to_h.stringify_keys
        blob = @asset_blobs_by_key[asset["key"].to_s] || @asset_blobs_by_key[asset["id"].to_s]
        next asset unless blob

        asset.merge(
          "id" => blob.id,
          "key" => blob.key,
          "filename" => blob.filename.to_s,
          "content_type" => blob.content_type,
          "byte_size" => blob.byte_size,
          "checksum" => blob.checksum
        )
      end.sort_by { |asset| [asset["key"].to_s, asset["filename"].to_s] }
    end

    def ensure_revision(work, source, reason: "import")
      digest = WorkRevision.digest(source)
      return @revisions_by_digest[digest] if @revisions_by_digest&.key?(digest)

      revision = work.work_revisions.find_by(source_digest: digest)
      return revision if revision

      revision = work.work_revisions.create!(
        workspace: @workspace,
        parent_revision: work.latest_checkpoint,
        source: source,
        source_digest: digest,
        reason: WorkRevision::REASONS.include?(reason) ? reason : "import",
        status: "checkpoint",
        metadata: { imported_source: true }
      )
      @revisions_by_digest ||= {}
      @revisions_by_digest[digest] = revision
      revision
    end
  end
end
