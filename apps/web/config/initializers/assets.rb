# Be sure to restart your server when you modify this file.

# Version of your assets, change this if you want to expire all your assets.
Rails.application.config.assets.version = "1.0"

# Add additional assets to the asset load path.
# Rails.application.config.assets.paths << Emoji.images_path

# Shared Elef packages are served to the browser by logical path so importmap
# can pin them (e.g. "@elef/work-model" → "work-model/dist/elef-work-model.js").
Rails.application.config.assets.paths << Rails.root.join("..", "..", "packages")
