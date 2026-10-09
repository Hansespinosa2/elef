class CreatePresentations < ActiveRecord::Migration[8.1]
  def change
    create_table :presentations do |t|
      t.string :title, null: false
      t.text :source, null: false

      t.timestamps
    end
  end
end
