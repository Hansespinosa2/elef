module Presentations
  class RenderCache
    RENDERER_VERSION = PresentationRelease::RENDERER_VERSION

    def self.key(source:, renderer_version: RENDERER_VERSION, settings: {}, asset_manifest: [])
      digest = Digest::SHA256.hexdigest(
        [WorkRevision.digest(source), renderer_version, JSON.generate(settings), JSON.generate(asset_manifest)].join("\0")
      )
      "presentation-render/#{digest}"
    end

    def self.fetch(source:, renderer_version: RENDERER_VERSION, settings: {}, asset_manifest: [], expires_in: 12.hours)
      key = self.key(source: source, renderer_version: renderer_version, settings: settings, asset_manifest: asset_manifest)
      Rails.cache.fetch(key, expires_in: expires_in) { yield }
    end
  end
end
