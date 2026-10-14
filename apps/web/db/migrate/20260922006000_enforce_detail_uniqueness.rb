class EnforceDetailUniqueness < ActiveRecord::Migration[8.1]
  def up
    make_unique :document_details
    make_unique :presentation_details
  end

  def down
    make_regular :document_details
    make_regular :presentation_details
  end

  private

  def make_unique(table)
    remove_index table, :work_id if index_exists?(table, :work_id, unique: false)
    add_index table, :work_id, unique: true unless index_exists?(table, :work_id, unique: true)
  end

  def make_regular(table)
    remove_index table, :work_id if index_exists?(table, :work_id, unique: true)
    add_index table, :work_id unless index_exists?(table, :work_id)
  end
end
