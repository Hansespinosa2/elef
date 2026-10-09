class AddSampleCompatibilityToWorks < ActiveRecord::Migration[8.1]
  def up
    add_column :works, :sample_id, :string unless column_exists?(:works, :sample_id)
    add_index :works, :sample_id, unique: true unless index_exists?(:works, :sample_id, unique: true)
    if connection.adapter_name == "PostgreSQL"
      execute <<~SQL
        UPDATE works
        SET sample_id = presentation_details.sample_id
        FROM presentation_details
        WHERE presentation_details.work_id = works.id
          AND presentation_details.sample_id IS NOT NULL
          AND works.sample_id IS NULL
      SQL
    else
      execute <<~SQL
        UPDATE works
        SET sample_id = (SELECT sample_id FROM presentation_details WHERE presentation_details.work_id = works.id)
        WHERE sample_id IS NULL
      SQL
    end
  end

  def down
    remove_index :works, :sample_id if index_exists?(:works, :sample_id, unique: true)
    remove_column :works, :sample_id if column_exists?(:works, :sample_id)
  end
end
