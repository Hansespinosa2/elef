class AddStyleSettingsToWorkspaces < ActiveRecord::Migration[8.1]
  def change
    add_column :workspaces, :settings, :text, null: false, default: "{}"
  end
end
