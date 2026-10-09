require "test_helper"
require Rails.root.join("db/migrate/20260922003000_add_sample_compatibility_to_works").to_s
require Rails.root.join("db/migrate/20260925100000_move_bb_alias_to_bold_math_shortcut").to_s

class SqliteCompatibilityTest < ActiveSupport::TestCase
  test "the adapter-specific migration backfills compatibility sample ids" do
    work = Work.create!(workspace: Workspace.default, kind: "presentation", title: "SQLite migration", source: "# SQLite")
    work.presentation_detail.update!(sample_id: "sqlite-migration-sample")

    AddSampleCompatibilityToWorks.new.up

    assert_equal "sqlite-migration-sample", work.reload.sample_id
  end

  test "the alias migration reads and writes serialized aliases" do
    workspace = Workspace.default
    source = MathShortcut.create!(
      workspace: workspace,
      name: "Blackboard bold",
      prefix: ".",
      aliases: ["bb"],
      expansion: "\\mathbb{${1:x}}",
      built_in: true
    )
    destination = MathShortcut.create!(
      workspace: workspace,
      name: "Bold",
      prefix: ".",
      aliases: ["bold"],
      expansion: "\\mathbf{${1:x}}",
      built_in: true
    )

    MoveBbAliasToBoldMathShortcut.new.up

    assert_empty source.reload.aliases
    assert_equal %w[bold bb], destination.reload.aliases
  end

  test "the database enforces foreign keys and partial document-title uniqueness" do
    connection = ActiveRecord::Base.connection
    if connection.adapter_name == "SQLite"
      assert_equal 1, connection.select_value("PRAGMA foreign_keys").to_i
    end

    workspace = Workspace.create!(name: "SQLite compatibility", slug: "sqlite-compatibility")
    now = connection.quote(Time.current)
    insert_work = lambda do |workspace_id:, kind:, title:|
      connection.execute(<<~SQL)
        INSERT INTO works (workspace_id, kind, title, source, lock_version, created_at, updated_at)
        VALUES (#{connection.quote(workspace_id)}, #{connection.quote(kind)}, #{connection.quote(title)}, '#{kind}', 0, #{now}, #{now})
      SQL
    end

    insert_work.call(workspace_id: workspace.id, kind: "document", title: "Unique document")
    assert_raises(ActiveRecord::RecordNotUnique) do
      insert_work.call(workspace_id: workspace.id, kind: "document", title: "Unique document")
    end

    insert_work.call(workspace_id: workspace.id, kind: "presentation", title: "Shared title")
    insert_work.call(workspace_id: workspace.id, kind: "presentation", title: "Shared title")

    assert_raises(ActiveRecord::InvalidForeignKey) do
      insert_work.call(workspace_id: -1, kind: "presentation", title: "Invalid workspace")
    end
  end

  test "optimistic locking rejects a stale write without replacing the saved source" do
    work = Work.create!(workspace: Workspace.default, kind: "presentation", title: "SQLite locking", source: "# Original")
    stale = Work.find(work.id)

    work.update!(source: "# Saved version")

    assert_raises(ActiveRecord::StaleObjectError) { stale.update!(source: "# Stale version") }
    assert_equal "# Saved version", work.reload.source
  end
end
