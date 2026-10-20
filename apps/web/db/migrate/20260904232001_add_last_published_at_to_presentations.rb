class AddLastPublishedAtToPresentations < ActiveRecord::Migration[8.1]
  def change
    add_column :presentations, :last_published_at, :datetime
  end
end
