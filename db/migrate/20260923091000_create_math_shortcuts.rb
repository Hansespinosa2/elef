class CreateMathShortcuts < ActiveRecord::Migration[8.1]
  def change
    create_table :math_shortcuts do |t|
      t.string :name, null: false
      t.text :aliases, null: false, default: "[]"
      t.string :description, null: false, default: ""
      t.string :prefix, null: false
      t.text :expansion, null: false
      t.boolean :built_in, null: false, default: false
      t.references :workspace, null: false, foreign_key: true
      t.timestamps
    end

    add_index :math_shortcuts, [:workspace_id, :prefix, :name], unique: true
  end
end
