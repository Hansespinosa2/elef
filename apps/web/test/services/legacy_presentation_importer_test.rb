require "test_helper"

class LegacyPresentationImporterTest < ActiveSupport::TestCase
  test "raises when legacy presentations table does not exist" do
    connection = ActiveRecord::Base.connection
    skip "Presentations table exists" if connection.data_source_exists?("presentations")

    error = assert_raises(RuntimeError) do
      LegacyPresentationImporter.call
    end
    assert_match /legacy presentations table is not available/, error.message
  end

  test "imports legacy presentation rows and establishes lineage" do
    connection = ActiveRecord::Base.connection
    connection.create_table :presentations, force: true do |t|
      t.string :title
      t.text :source
      t.string :work_type
      t.integer :parent_id
      t.string :fork_type
      t.text :fork_source
      t.string :fork_parent_title
      t.datetime :last_published_at
      t.timestamps
    end
    connection.schema_cache.clear!

    time = Time.current.change(usec: 0)
    # Insert parent
    connection.execute(<<~SQL)
      INSERT INTO presentations (id, title, source, work_type, created_at, updated_at)
      VALUES (99001, 'Legacy Parent', '# Parent source', 'presentation', '#{time.to_fs(:db)}', '#{time.to_fs(:db)}')
    SQL

    # Insert child fork
    connection.execute(<<~SQL)
      INSERT INTO presentations (id, title, source, work_type, parent_id, fork_type, fork_source, fork_parent_title, last_published_at, created_at, updated_at)
      VALUES (99002, 'Legacy Child', '# Child source', 'presentation', 99001, 'inspiration', '# Parent source', 'Legacy Parent', '#{time.to_fs(:db)}', '#{time.to_fs(:db)}', '#{time.to_fs(:db)}')
    SQL

    imported_count = LegacyPresentationImporter.call
    assert_equal 2, imported_count

    parent_work = Presentation.find(99001)
    child_work = Presentation.find(99002)

    assert_equal "Legacy Parent", parent_work.title
    assert_equal "# Parent source", parent_work.source

    assert_equal "Legacy Child", child_work.title
    assert_equal "# Child source", child_work.source
    assert_equal "inspiration", child_work.fork_type
    assert_equal "Legacy Parent", child_work.fork_parent_title

    # Idempotent: repeated calls do not re-import existing IDs
    assert_equal 0, LegacyPresentationImporter.call
  ensure
    connection.drop_table :presentations, if_exists: true rescue nil
  end
end
