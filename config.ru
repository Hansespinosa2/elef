# This file is used by Rack-based servers to start the application.

require_relative "config/environment"

relative_url_root = ENV["RAILS_RELATIVE_URL_ROOT"].to_s
if relative_url_root.empty?
  run Rails.application
else
  run Rack::URLMap.new(relative_url_root => Rails.application, "/" => Rails.application)
end

Rails.application.load_server
