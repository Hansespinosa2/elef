require_relative "../config/environment"

output = Rails.root.join("app/javascript/data/default_authoring_registry.json")
File.write(output, JSON.pretty_generate(AuthoringRegistry.built_in_entries) + "\n")
puts "Wrote #{output.relative_path_from(Rails.root)}"
