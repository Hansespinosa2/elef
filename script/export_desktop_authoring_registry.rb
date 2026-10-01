require_relative "../config/environment"

output = Rails.root.join("desktop/frontend/src/default-authoring-registry.json")
File.write(output, JSON.pretty_generate(AuthoringRegistry.defaults_for_desktop) + "\n")
puts "Wrote #{output.relative_path_from(Rails.root)}"
