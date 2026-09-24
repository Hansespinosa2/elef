require "digest"

module Presentations
  module MediaAssets
    module_function

    def digest(blob)
      cached = blob.metadata["elef_sha256"] || blob.metadata[:elef_sha256]
      return cached if cached.present?

      Digest::SHA256.hexdigest(blob.download)
    end

    def index(work)
      work.assets.blobs.each_with_object({}) do |blob, assets|
        assets[digest(blob)] = blob
      end
    end

    def markdown_source(digest, alt:, fit:)
      safe_alt = alt.to_s.gsub(/[\r\n]+/, " ").gsub(/[\\\[\]]/) { |character| "\\#{character}" }
      "![#{safe_alt}](elef-asset:#{digest} \"fit:#{fit}\")"
    end
  end
end
