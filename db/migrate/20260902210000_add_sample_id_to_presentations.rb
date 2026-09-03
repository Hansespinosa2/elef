class AddSampleIdToPresentations < ActiveRecord::Migration[8.1]
  def change
    add_column :presentations, :sample_id, :string
    add_index :presentations, :sample_id, unique: true
  end
end
