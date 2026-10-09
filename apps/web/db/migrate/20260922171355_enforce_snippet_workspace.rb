class EnforceSnippetWorkspace < ActiveRecord::Migration[8.1]
  def up
    workspace_id = select_value("SELECT id FROM workspaces WHERE slug = #{connection.quote("default")} LIMIT 1")
    execute "UPDATE snippets SET workspace_id = #{connection.quote(workspace_id)} WHERE workspace_id IS NULL" if workspace_id
    change_column_null :snippets, :workspace_id, false
  end

  def down
    change_column_null :snippets, :workspace_id, true
  end
end
