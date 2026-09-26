require "fileutils"
require "set"

module Presentations
  module FolderSync
    module_function

    def base_path
      if Rails.env.test?
        Rails.root.join("tmp/storage/presentations", Process.pid.to_s)
      else
        Rails.root.join("storage/presentations")
      end
    end

    def presentation_dir(presentation)
      id = presentation.respond_to?(:id) ? presentation.id : presentation
      base_path.join(id.to_s)
    end

    def sync!(presentation)
      return unless presentation&.persisted?

      dir = presentation_dir(presentation)
      FileUtils.mkdir_p(dir)

      # 1. Write portable presentation markdown
      portable_source = WorkAssets.portable_markdown(presentation.source.to_s, presentation)
      File.write(dir.join("presentation.md"), portable_source)

      # 2. Write raw source
      File.write(dir.join("source.md"), presentation.source.to_s)

      # 3. Write assets to assets/ subdirectory
      assets_dir = dir.join("assets")
      FileUtils.mkdir_p(assets_dir)

      current_filenames = Set.new
      if presentation.assets.attached?
        presentation.assets.each do |asset|
          filename = asset.blob.filename.to_s
          current_filenames << filename
          target_path = assets_dir.join(filename)
          unless File.exist?(target_path) && File.size(target_path) == asset.blob.byte_size
            File.binwrite(target_path, asset.blob.download)
          end
        end
      end

      # Clean up removed assets
      Dir.glob(assets_dir.join("*")).each do |file|
        FileUtils.rm_f(file) unless current_filenames.include?(File.basename(file))
      end

      dir
    rescue StandardError => e
      Rails.logger.warn("Presentations::FolderSync failed for #{presentation&.id}: #{e.message}")
      nil
    end

    def remove!(presentation)
      return unless presentation

      dir = presentation_dir(presentation)
      FileUtils.rm_rf(dir) if File.exist?(dir)
    rescue StandardError => e
      Rails.logger.warn("Presentations::FolderSync remove failed for #{presentation&.id}: #{e.message}")
      nil
    end
  end
end
