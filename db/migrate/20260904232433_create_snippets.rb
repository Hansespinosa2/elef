class CreateSnippets < ActiveRecord::Migration[8.1]
  def change
    create_table :snippets do |t|
      t.string :name, null: false
      t.string :trigger, null: false
      t.string :description, null: false, default: ""
      t.string :category, null: false, default: "Markdown"
      t.text :body, null: false
      t.boolean :built_in, null: false, default: false

      t.timestamps
    end

    add_index :snippets, [:trigger, :built_in]
    add_index :snippets, :category
  end
end
