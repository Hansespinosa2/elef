class AddUniqueDocumentTitleIndex < ActiveRecord::Migration[8.1]
  def change
    add_index :presentations, [:work_type, :title], unique: true,
      where: "work_type = 'document'", name: "index_documents_on_work_type_and_title"
  end
end
