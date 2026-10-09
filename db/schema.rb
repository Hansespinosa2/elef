# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_09_165422) do
  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
    t.index ["record_type", "record_id", "name"], name: "index_active_storage_attachments_lookup"
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "document_aliases", force: :cascade do |t|
    t.string "alias_name", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "work_id", null: false
    t.bigint "workspace_id", null: false
    t.index ["work_id", "alias_name"], name: "index_document_aliases_on_work_id_and_alias_name", unique: true
    t.index ["work_id"], name: "index_document_aliases_on_work_id"
    t.index ["workspace_id", "alias_name"], name: "index_document_aliases_on_workspace_id_and_alias_name", unique: true
    t.index ["workspace_id"], name: "index_document_aliases_on_workspace_id"
  end

  create_table "document_details", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "document_key", null: false
    t.string "slug"
    t.datetime "updated_at", null: false
    t.bigint "work_id", null: false
    t.index ["document_key"], name: "index_document_details_on_document_key", unique: true
    t.index ["work_id"], name: "index_document_details_on_work_id", unique: true
  end

  create_table "math_shortcuts", force: :cascade do |t|
    t.text "aliases", default: "[]", null: false
    t.boolean "built_in", default: false, null: false
    t.datetime "created_at", null: false
    t.string "description", default: "", null: false
    t.text "expansion", null: false
    t.string "name", null: false
    t.string "prefix", null: false
    t.datetime "updated_at", null: false
    t.integer "workspace_id", null: false
    t.index ["workspace_id", "prefix", "name"], name: "index_math_shortcuts_on_workspace_id_and_prefix_and_name", unique: true
    t.index ["workspace_id"], name: "index_math_shortcuts_on_workspace_id"
  end

  create_table "presentation_details", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "sample_id"
    t.text "settings"
    t.datetime "updated_at", null: false
    t.bigint "work_id", null: false
    t.index ["sample_id"], name: "index_presentation_details_on_sample_id", unique: true
    t.index ["work_id"], name: "index_presentation_details_on_work_id", unique: true
  end

  create_table "presentation_lineage_edges", force: :cascade do |t|
    t.bigint "child_work_id", null: false
    t.datetime "created_at", null: false
    t.string "fork_type", null: false
    t.bigint "origin_revision_id"
    t.text "origin_source_snapshot"
    t.string "parent_title_snapshot"
    t.bigint "parent_work_id"
    t.datetime "updated_at", null: false
    t.index ["child_work_id"], name: "index_presentation_lineage_edges_on_child_work_id", unique: true
    t.index ["parent_work_id"], name: "index_presentation_lineage_edges_on_parent_work_id"
  end

  create_table "presentation_releases", force: :cascade do |t|
    t.text "asset_manifest", default: "[]", null: false
    t.datetime "created_at", null: false
    t.datetime "published_at", null: false
    t.string "render_digest", null: false
    t.text "rendered_artifact"
    t.string "renderer_version", null: false
    t.text "settings", default: "{}", null: false
    t.string "source_digest", null: false
    t.bigint "source_revision_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "work_id", null: false
    t.index ["source_revision_id"], name: "index_presentation_releases_on_source_revision_id"
    t.index ["work_id", "render_digest"], name: "index_releases_on_work_and_render_digest", unique: true
    t.index ["work_id", "source_digest"], name: "index_presentation_releases_on_work_id_and_source_digest"
    t.index ["work_id"], name: "index_presentation_releases_on_work_id"
  end

  create_table "snippets", force: :cascade do |t|
    t.text "body", null: false
    t.boolean "built_in", default: false, null: false
    t.string "category", default: "Markdown", null: false
    t.datetime "created_at", null: false
    t.string "description", default: "", null: false
    t.string "name", null: false
    t.string "trigger", null: false
    t.datetime "updated_at", null: false
    t.bigint "workspace_id", null: false
    t.index ["category"], name: "index_snippets_on_category"
    t.index ["trigger", "built_in"], name: "index_snippets_on_trigger_and_built_in"
    t.index ["workspace_id"], name: "index_snippets_on_workspace_id"
  end

  create_table "work_revisions", force: :cascade do |t|
    t.bigint "author_id"
    t.bigint "base_revision_id"
    t.datetime "created_at", null: false
    t.string "edit_session_id"
    t.text "metadata"
    t.bigint "parent_revision_id"
    t.string "reason", default: "checkpoint", null: false
    t.text "source", null: false
    t.string "source_digest", null: false
    t.string "status", default: "checkpoint", null: false
    t.datetime "updated_at", null: false
    t.bigint "work_id", null: false
    t.bigint "workspace_id", null: false
    t.index ["edit_session_id"], name: "index_work_revisions_on_edit_session_id"
    t.index ["work_id", "created_at"], name: "index_work_revisions_on_work_id_and_created_at"
    t.index ["work_id", "source_digest"], name: "index_work_revisions_on_work_id_and_source_digest"
    t.index ["work_id"], name: "index_work_revisions_on_work_id"
    t.index ["workspace_id"], name: "index_work_revisions_on_workspace_id"
  end

  create_table "works", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "kind", null: false
    t.bigint "latest_checkpoint_id"
    t.integer "lock_version", default: 0, null: false
    t.bigint "published_release_id"
    t.string "sample_id"
    t.text "source", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.bigint "workspace_id", null: false
    t.index ["kind"], name: "index_works_on_kind"
    t.index ["sample_id"], name: "index_works_on_sample_id", unique: true
    t.index ["workspace_id", "title"], name: "index_works_on_workspace_and_document_title", unique: true, where: "kind = 'document'"
    t.index ["workspace_id"], name: "index_works_on_workspace_id"
  end

  create_table "workspaces", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.text "settings", default: "{}", null: false
    t.string "slug", null: false
    t.boolean "system", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_workspaces_on_slug", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "document_aliases", "works"
  add_foreign_key "document_aliases", "workspaces"
  add_foreign_key "document_details", "works"
  add_foreign_key "math_shortcuts", "workspaces"
  add_foreign_key "presentation_details", "works"
  add_foreign_key "presentation_lineage_edges", "work_revisions", column: "origin_revision_id", on_delete: :nullify
  add_foreign_key "presentation_lineage_edges", "works", column: "child_work_id", on_delete: :cascade
  add_foreign_key "presentation_lineage_edges", "works", column: "parent_work_id", on_delete: :nullify
  add_foreign_key "presentation_releases", "work_revisions", column: "source_revision_id"
  add_foreign_key "presentation_releases", "works"
  add_foreign_key "snippets", "workspaces"
  add_foreign_key "work_revisions", "work_revisions", column: "base_revision_id", on_delete: :nullify
  add_foreign_key "work_revisions", "work_revisions", column: "parent_revision_id", on_delete: :nullify
  add_foreign_key "work_revisions", "works"
  add_foreign_key "work_revisions", "workspaces"
  add_foreign_key "works", "presentation_releases", column: "published_release_id", on_delete: :nullify
  add_foreign_key "works", "work_revisions", column: "latest_checkpoint_id", on_delete: :nullify
  add_foreign_key "works", "workspaces"
end
