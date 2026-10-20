class AssignSnippetWorkspace < ActiveRecord::Migration[8.1]
  def up
    workspace_id = select_value("SELECT id FROM workspaces WHERE slug = #{connection.quote("default")} LIMIT 1")
    return unless workspace_id

    execute "UPDATE snippets SET workspace_id = #{connection.quote(workspace_id)} WHERE workspace_id IS NULL"
  end

  def down
    # Workspace ownership is additive; leaving the association in place is safer
    # than discarding ownership metadata during a rollback.
  end
end
