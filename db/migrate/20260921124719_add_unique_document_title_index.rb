class AddUniqueDocumentTitleIndex < ActiveRecord::Migration[8.1]
  def up
    normalize_duplicate_document_titles
    add_index :presentations, [:work_type, :title], unique: true,
      where: "work_type = 'document'", name: "index_documents_on_work_type_and_title"
  end

  def down
    remove_index :presentations, name: "index_documents_on_work_type_and_title"
  end

  private

  def normalize_duplicate_document_titles
    duplicate_titles = connection.select_values(<<~SQL)
      SELECT title
      FROM presentations
      WHERE work_type = 'document'
      GROUP BY title
      HAVING COUNT(*) > 1
    SQL

    duplicate_titles.each do |title|
      duplicate_ids = connection.select_values(
        "SELECT id FROM presentations WHERE work_type = 'document' AND title = #{connection.quote(title)} ORDER BY id"
      ).drop(1)

      duplicate_ids.each_with_index do |id, index|
        number = index + 2
        loop do
          suffix = " (#{number})"
          candidate = "#{title.to_s.truncate(120 - suffix.length)}#{suffix}"
          available = connection.select_value(
            "SELECT 1 FROM presentations WHERE work_type = 'document' AND title = #{connection.quote(candidate)} LIMIT 1"
          ).nil?
          break if available

          number += 1
        end

        execute <<~SQL
          UPDATE presentations
          SET title = #{connection.quote(candidate)}
          WHERE id = #{connection.quote(id)}
        SQL
      end
    end
  end
end
