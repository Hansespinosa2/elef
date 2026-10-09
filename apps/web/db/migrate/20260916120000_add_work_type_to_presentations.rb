class AddWorkTypeToPresentations < ActiveRecord::Migration[8.1]
  def change
    add_column :presentations, :work_type, :string, null: false, default: "presentation"
    add_index :presentations, :work_type
  end
end
