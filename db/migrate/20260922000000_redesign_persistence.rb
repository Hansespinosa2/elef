require "digest"
require "securerandom"

class RedesignPersistence < ActiveRecord::Migration[8.1]
  REVISION_DIGEST = ->(source) { Digest::SHA256.hexdigest(source.to_s) }

  def up
    create_workspaces
    create_works
    create_work_revisions
    create_document_details
    create_document_aliases
    create_presentation_details
    create_presentation_releases
    create_lineage_edges
    add_workspace_to_snippets
    create_active_storage_tables

    migrate_legacy_presentations
    reset_primary_key_sequences
    add_referential_integrity
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "The legacy presentations table is not recreated by this migration"
  end

  private

  def create_workspaces
    create_table :workspaces do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.boolean :system, null: false, default: false
      t.timestamps
    end
    add_index :workspaces, :slug, unique: true
  end

  def create_works
    create_table :works do |t|
      t.references :workspace, null: false, foreign_key: true
      t.string :kind, null: false
      t.string :sample_id
      t.string :title, null: false
      t.text :source, null: false
      t.integer :lock_version, null: false, default: 0
      t.bigint :latest_checkpoint_id
      t.bigint :published_release_id
      t.timestamps
    end
    add_index :works, :kind
    add_index :works, [:workspace_id, :title],
      unique: true,
      where: "kind = 'document'",
      name: "index_works_on_workspace_and_document_title"
  end

  def create_work_revisions
    create_table :work_revisions do |t|
      t.references :workspace, null: false, foreign_key: true
      t.references :work, null: false, foreign_key: true
      t.bigint :parent_revision_id
      t.bigint :base_revision_id
      t.text :source, null: false
      t.string :source_digest, null: false
      t.string :reason, null: false, default: "checkpoint"
      t.string :status, null: false, default: "checkpoint"
      t.string :edit_session_id
      t.bigint :author_id
      t.text :metadata
      t.timestamps
    end
    add_index :work_revisions, [:work_id, :created_at]
    add_index :work_revisions, [:work_id, :source_digest]
    add_index :work_revisions, :edit_session_id
  end

  def create_document_details
    create_table :document_details do |t|
      t.references :work, null: false, foreign_key: true
      t.string :document_key, null: false
      t.string :slug
      t.timestamps
    end
    add_index :document_details, :document_key, unique: true
  end

  def create_document_aliases
    create_table :document_aliases do |t|
      t.references :workspace, null: false, foreign_key: true
      t.references :work, null: false, foreign_key: true
      t.string :alias_name, null: false
      t.timestamps
    end
    add_index :document_aliases, [:workspace_id, :alias_name], unique: true
    add_index :document_aliases, [:work_id, :alias_name], unique: true
  end

  def create_presentation_details
    create_table :presentation_details do |t|
      t.references :work, null: false, foreign_key: true
      t.string :sample_id
      t.text :settings
      t.timestamps
    end
    add_index :presentation_details, :sample_id, unique: true
  end

  def create_presentation_releases
    create_table :presentation_releases do |t|
      t.references :work, null: false, foreign_key: true
      t.references :source_revision, null: false, foreign_key: { to_table: :work_revisions }
      t.string :source_digest, null: false
      t.string :renderer_version, null: false
      t.text :settings, null: false, default: "{}"
      t.text :asset_manifest, null: false, default: "[]"
      t.string :render_digest, null: false
      t.text :rendered_artifact
      t.datetime :published_at, null: false
      t.timestamps
    end
    add_index :presentation_releases, [:work_id, :source_digest]
    add_index :presentation_releases, [:work_id, :render_digest], unique: true,
      name: "index_releases_on_work_and_render_digest"
  end

  def create_lineage_edges
    create_table :presentation_lineage_edges do |t|
      t.references :parent_work, index: false
      t.references :child_work, null: false, index: false
      t.references :origin_revision, index: false
      t.string :fork_type, null: false
      t.string :parent_title_snapshot
      t.text :origin_source_snapshot
      t.timestamps
    end
    add_index :presentation_lineage_edges, :child_work_id, unique: true
    add_index :presentation_lineage_edges, :parent_work_id
  end

  def add_workspace_to_snippets
    add_reference :snippets, :workspace, foreign_key: true
  end

  def create_active_storage_tables
    create_table :active_storage_blobs do |t|
      t.string :key, null: false
      t.string :filename, null: false
      t.string :content_type
      t.text :metadata
      t.bigint :byte_size, null: false
      t.string :checksum
      t.string :service_name, null: false
      t.timestamps
    end
    add_index :active_storage_blobs, :key, unique: true

    create_table :active_storage_attachments do |t|
      t.string :name, null: false
      t.string :record_type, null: false
      t.bigint :record_id, null: false
      t.references :blob, null: false, foreign_key: { to_table: :active_storage_blobs }
      t.datetime :created_at, null: false
    end
    add_index :active_storage_attachments, [:record_type, :record_id, :name, :blob_id],
      unique: true,
      name: "index_active_storage_attachments_uniqueness"
    add_index :active_storage_attachments, [:record_type, :record_id, :name],
      name: "index_active_storage_attachments_lookup"
  end

  def migrate_legacy_presentations
    workspace_id = insert_workspace("Default workspace", "default")
    return unless table_exists?(:presentations)
    revisions_by_work_id = {}
    kinds_by_work_id = {}
    legacy_rows = select_all("SELECT * FROM presentations ORDER BY id").to_a

    legacy_rows.each do |row|
      work_id = row.fetch("id")
      source = row["source"].to_s
      kind = row["work_type"].presence || "presentation"
      created_at = row["created_at"] || Time.current
      updated_at = row["updated_at"] || created_at

      execute <<~SQL
        INSERT INTO works (id, workspace_id, kind, sample_id, title, source, lock_version, created_at, updated_at)
        VALUES (#{quote(work_id)}, #{quote(workspace_id)}, #{quote(kind)}, #{quote_or_null(row["sample_id"])},
          #{quote(row["title"].presence || default_title(kind))}, #{quote(source)}, 0, #{quote(created_at)}, #{quote(updated_at)})
      SQL

      if kind == "document"
        execute <<~SQL
          INSERT INTO document_details (work_id, document_key, created_at, updated_at)
          VALUES (#{quote(work_id)}, #{quote(SecureRandom.uuid)}, #{quote(created_at)}, #{quote(updated_at)})
        SQL
        insert_document_alias(workspace_id, work_id, row["title"], created_at, updated_at)
      else
        sample_id = row["sample_id"]
        execute <<~SQL
          INSERT INTO presentation_details (work_id, sample_id, settings, created_at, updated_at)
          VALUES (#{quote(work_id)}, #{quote_or_null(sample_id)}, #{quote("{}")}, #{quote(created_at)}, #{quote(updated_at)})
        SQL
      end

      revision_id = insert_revision(workspace_id, work_id, source, created_at, updated_at, "checkpoint")
      revisions_by_work_id[work_id.to_i] = revision_id
      kinds_by_work_id[work_id.to_i] = kind
      execute "UPDATE works SET latest_checkpoint_id = #{quote(revision_id)} WHERE id = #{quote(work_id)}"
    end

    legacy_rows.each do |row|
      next unless row["work_type"].to_s == "presentation"
      next unless row["parent_id"].present? || row["fork_source"].present? || row["fork_parent_title"].present?
      next unless revisions_by_work_id[row["id"].to_i]

      parent_id = row["parent_id"].to_i if row["parent_id"].present?
      parent_is_present = kinds_by_work_id[parent_id] == "presentation" && revisions_by_work_id[parent_id]
      imported_parent_id = parent_is_present ? parent_id : nil
      imported_origin_revision_id = parent_is_present ? revisions_by_work_id[parent_id] : nil

      fork_type = row["fork_type"].presence
      fork_type = "continuation" unless %w[continuation inspiration].include?(fork_type)

      execute <<~SQL
        INSERT INTO presentation_lineage_edges
          (parent_work_id, child_work_id, origin_revision_id, fork_type, parent_title_snapshot, origin_source_snapshot, created_at, updated_at)
        VALUES (
          #{quote_or_null(imported_parent_id)}, #{quote(row["id"])}, #{quote_or_null(imported_origin_revision_id)},
          #{quote(fork_type)}, #{quote_or_null(row["fork_parent_title"])}, #{quote_or_null(row["fork_source"])},
          #{quote(row["created_at"] || Time.current)}, #{quote(row["updated_at"] || row["created_at"] || Time.current)}
        )
      SQL
    end

    legacy_rows.each do |row|
      published_at = row["last_published_at"]
      next if row["work_type"].to_s != "presentation" || published_at.blank?

      work_id = row.fetch("id")
      revision_id = revisions_by_work_id.fetch(work_id.to_i)
      source = row["source"].to_s
      settings = "{}"
      render_digest = REVISION_DIGEST.call([REVISION_DIGEST.call(source), "legacy", settings, "[]"].join("\0"))
      execute <<~SQL
        INSERT INTO presentation_releases
          (work_id, source_revision_id, source_digest, renderer_version, settings, asset_manifest,
           render_digest, published_at, created_at, updated_at)
        VALUES (
          #{quote(work_id)}, #{quote(revision_id)}, #{quote(REVISION_DIGEST.call(source))}, #{quote("legacy")},
          #{quote(settings)}, #{quote("[]")}, #{quote(render_digest)}, #{quote(published_at)},
          #{quote(published_at)}, #{quote(published_at)}
        )
      SQL
      release_id = select_value("SELECT id FROM presentation_releases WHERE work_id = #{quote(work_id)} AND render_digest = #{quote(render_digest)}")
      execute "UPDATE works SET published_release_id = #{quote(release_id)} WHERE id = #{quote(work_id)}"
    end

    execute "UPDATE snippets SET workspace_id = #{quote(workspace_id)} WHERE workspace_id IS NULL"

    drop_table :presentations
  end

  def add_referential_integrity
    add_foreign_key :work_revisions, :work_revisions, column: :parent_revision_id, on_delete: :nullify
    add_foreign_key :work_revisions, :work_revisions, column: :base_revision_id, on_delete: :nullify
    add_foreign_key :works, :work_revisions, column: :latest_checkpoint_id, on_delete: :nullify
    add_foreign_key :works, :presentation_releases, column: :published_release_id, on_delete: :nullify
    add_foreign_key :presentation_lineage_edges, :work_revisions,
      column: :origin_revision_id, on_delete: :nullify
    add_foreign_key :presentation_lineage_edges, :works,
      column: :parent_work_id, on_delete: :nullify
    add_foreign_key :presentation_lineage_edges, :works,
      column: :child_work_id, on_delete: :cascade
  end

  def reset_primary_key_sequences
    return unless connection.respond_to?(:reset_pk_sequence!)

    connection.reset_pk_sequence!("workspaces")
    connection.reset_pk_sequence!("works")
    connection.reset_pk_sequence!("work_revisions")
  end

  def insert_workspace(name, slug)
    execute <<~SQL
      INSERT INTO workspaces (name, slug, system, created_at, updated_at)
      VALUES (#{quote(name)}, #{quote(slug)}, TRUE, #{quote(Time.current)}, #{quote(Time.current)})
    SQL
    select_value("SELECT id FROM workspaces WHERE slug = #{quote(slug)}")
  end

  def insert_document_alias(workspace_id, work_id, name, created_at, updated_at)
    return if name.blank?

    execute <<~SQL
      INSERT INTO document_aliases (workspace_id, work_id, alias_name, created_at, updated_at)
      VALUES (#{quote(workspace_id)}, #{quote(work_id)}, #{quote(name)}, #{quote(created_at)}, #{quote(updated_at)})
    SQL
  end

  def insert_revision(workspace_id, work_id, source, created_at, updated_at, reason)
    digest = REVISION_DIGEST.call(source)
    execute <<~SQL
      INSERT INTO work_revisions
        (workspace_id, work_id, source, source_digest, reason, status, created_at, updated_at)
      VALUES (
        #{quote(workspace_id)}, #{quote(work_id)}, #{quote(source)}, #{quote(digest)},
        #{quote(reason)}, #{quote("checkpoint")}, #{quote(created_at)}, #{quote(updated_at)}
      )
    SQL
    select_value(<<~SQL)
      SELECT id FROM work_revisions
      WHERE work_id = #{quote(work_id)} AND source_digest = #{quote(digest)}
      ORDER BY id DESC LIMIT 1
    SQL
  end

  def quote_or_null(value)
    value.present? ? quote(value) : "NULL"
  end

  def default_title(kind)
    kind == "document" ? "Untitled document" : "Untitled presentation"
  end
end
