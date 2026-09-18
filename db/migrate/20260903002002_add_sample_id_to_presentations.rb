class AddSampleIdToPresentations < ActiveRecord::Migration[8.1]
  # This migration replaced the original 20260902210000 migration after it
  # had already been applied in some development databases. Keep the ordered
  # filename for fresh databases, but tolerate the existing schema so Rails
  # can record the replacement version and clear PendingMigrationError.
  def up
    add_column :presentations, :sample_id, :string unless column_exists?(:presentations, :sample_id)
    add_index :presentations, :sample_id, unique: true unless index_exists?(:presentations, :sample_id, unique: true)
  end

  def down
    remove_index :presentations, :sample_id if index_exists?(:presentations, :sample_id)
    remove_column :presentations, :sample_id if column_exists?(:presentations, :sample_id)
  end
end
