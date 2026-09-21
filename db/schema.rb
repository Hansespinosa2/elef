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

ActiveRecord::Schema[8.1].define(version: 2026_09_21_124719) do
  create_table "presentations", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "fork_parent_title"
    t.text "fork_source"
    t.string "fork_type"
    t.datetime "last_published_at"
    t.integer "parent_id"
    t.string "sample_id"
    t.text "source", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.string "work_type", default: "presentation", null: false
    t.index ["parent_id"], name: "index_presentations_on_parent_id"
    t.index ["sample_id"], name: "index_presentations_on_sample_id", unique: true
    t.index ["work_type", "title"], name: "index_documents_on_work_type_and_title", unique: true, where: "work_type = 'document'"
    t.index ["work_type"], name: "index_presentations_on_work_type"
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
    t.index ["category"], name: "index_snippets_on_category"
    t.index ["trigger", "built_in"], name: "index_snippets_on_trigger_and_built_in"
  end

  add_foreign_key "presentations", "presentations", column: "parent_id", on_delete: :nullify
end
