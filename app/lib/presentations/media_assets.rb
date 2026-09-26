require "digest"

module Presentations
  module MediaAssets
    module_function

    def digest(blob)
      cached = blob.metadata["elef_sha256"] || blob.metadata[:elef_sha256]
      return cached if cached.present?

      calculated = Digest::SHA256.hexdigest(blob.download)
      if blob.persisted?
        new_metadata = blob.metadata.merge("elef_sha256" => calculated)
        blob.update_columns(metadata: new_metadata)
        blob.metadata = new_metadata
      end
      calculated
    rescue StandardError
      Digest::SHA256.hexdigest(blob.download)
    end

    def index(work)
      return {} unless work.respond_to?(:assets)

      blobs = work.assets.blobs
      assets = {}
      blobs.each do |blob|
        sha = digest(blob)
        filename = blob.filename.to_s
        assets[sha] = blob
        assets[filename] = blob
        assets["assets/#{filename}"] = blob
        assets["./assets/#{filename}"] = blob
        assets["/assets/#{filename}"] = blob
        assets[blob.key] = blob
        assets[blob.id.to_s] = blob
      end
      assets
    end

    def resolve_blob(work, identifier)
      return nil unless work.respond_to?(:assets) && identifier.present?

      identifier_str = identifier.to_s.strip
      cleaned = identifier_str.sub(/\Aelef-asset:/, "").sub(/\A\.?\/?assets\//, "").strip
      assets_map = index(work)

      assets_map[identifier_str] ||
        assets_map[cleaned] ||
        assets_map[File.basename(identifier_str)]
    end

    def resolver_for(work)
      assets_map = nil
      owner_path = work.document? ? "documents" : "presentations"
      lambda do |identifier|
        assets_map ||= index(work)
        value = identifier.to_s.strip
        cleaned = value.sub(/\Aelef-asset:/, "").sub(/\A\.?\/?assets\//, "").strip
        blob = assets_map[value] || assets_map[cleaned] || assets_map[File.basename(value)]
        blob && ["/#{owner_path}/#{work.id}/assets/#{digest(blob)}", blob.content_type]
      end
    end

    def resolve_media(work, identifier)
      blob = resolve_blob(work, identifier)
      return nil unless blob

      sha = digest(blob)
      owner_path = work.document? ? "documents" : "presentations"
      ["/#{owner_path}/#{work.id}/assets/#{sha}", blob.content_type]
    end

    def markdown_source(identifier, alt:, fit:)
      safe_alt = alt.to_s.gsub(/[\r\n]+/, " ").gsub(/[\\\[\]]/) { |character| "\\#{character}" }
      "![#{safe_alt}](elef-asset:#{identifier} \"fit:#{fit}\")"
    end

    def portable_markdown(source, work)
      return source.to_s unless work.respond_to?(:assets) && source.to_s.include?("elef-asset:") && work.assets.attached?

      index_map = {}
      work.assets.blobs.each do |blob|
        sha = digest(blob)
        index_map[sha] = blob.filename.to_s
      end

      source.to_s.gsub(/!\[([^\]]*)\]\(elef-asset:([0-9a-f]{64})(?:\s+([^)]*))?\)/) do
        alt = Regexp.last_match(1)
        sha = Regexp.last_match(2)
        title = Regexp.last_match(3)
        filename = index_map[sha] || "#{sha}.png"
        title_suffix = title.present? ? " #{title}" : ""
        "![#{alt}](assets/#{filename}#{title_suffix})"
      end
    end
  end
end
