class FixLineageForeignKeys < ActiveRecord::Migration[8.1]
  def up
    remove_lineage_foreign_keys
    add_foreign_key :presentation_lineage_edges, :work_revisions,
      column: :origin_revision_id, on_delete: :nullify
    add_foreign_key :presentation_lineage_edges, :works,
      column: :parent_work_id, on_delete: :nullify
    add_foreign_key :presentation_lineage_edges, :works,
      column: :child_work_id, on_delete: :cascade
  end

  def down
    remove_lineage_foreign_keys
  end

  private

  def remove_lineage_foreign_keys
    connection.foreign_keys(:presentation_lineage_edges).each do |foreign_key|
      remove_foreign_key :presentation_lineage_edges, name: foreign_key.name
    end
  end
end
