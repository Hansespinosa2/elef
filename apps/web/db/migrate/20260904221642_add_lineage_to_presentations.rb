class AddLineageToPresentations < ActiveRecord::Migration[8.1]
  def change
    add_column :presentations, :parent_id, :integer
    add_column :presentations, :fork_type, :string
    add_column :presentations, :fork_source, :text
    add_column :presentations, :fork_parent_title, :string

    add_index :presentations, :parent_id
    add_foreign_key :presentations, :presentations, column: :parent_id, on_delete: :nullify
  end
end
