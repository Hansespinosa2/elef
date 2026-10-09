class AddLineageOriginSnapshot < ActiveRecord::Migration[8.1]
  def up
    add_column :presentation_lineage_edges, :origin_source_snapshot, :text unless column_exists?(:presentation_lineage_edges, :origin_source_snapshot)
    change_column_null :presentation_lineage_edges, :origin_revision_id, true
  end

  def down
    remove_column :presentation_lineage_edges, :origin_source_snapshot if column_exists?(:presentation_lineage_edges, :origin_source_snapshot)
    change_column_null :presentation_lineage_edges, :origin_revision_id, false
  end
end
