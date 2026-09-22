namespace :elef do
  namespace :work do
    desc "Import an exported Elef work package without replacing existing work"
    task :import, [:package] => :environment do |_task, arguments|
      package_path = arguments[:package].presence || ENV["PACKAGE"]
      abort "Usage: bin/rails 'elef:work:import[path/to/work.zip]'" if package_path.blank?

      work = WorkPackage::Importer.call(package_path)
      puts "Imported #{work.kind} #{work.id}: #{work.title}"
    end

    desc "Import rows from a legacy presentations table when one is still available"
    task import_legacy: :environment do
      imported = LegacyPresentationImporter.call
      puts "Imported #{imported} legacy works"
    end
  end
end
