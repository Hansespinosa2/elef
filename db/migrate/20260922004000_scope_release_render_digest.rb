class ScopeReleaseRenderDigest < ActiveRecord::Migration[8.1]
  INDEX_NAME = "index_presentation_releases_on_render_digest"
  SCOPED_INDEX_NAME = "index_releases_on_work_and_render_digest"

  def up
    remove_index :presentation_releases, name: INDEX_NAME if index_exists?(:presentation_releases, name: INDEX_NAME)
    add_index :presentation_releases, [:work_id, :render_digest], unique: true, name: SCOPED_INDEX_NAME unless index_exists?(:presentation_releases, name: SCOPED_INDEX_NAME)
  end

  def down
    remove_index :presentation_releases, name: SCOPED_INDEX_NAME if index_exists?(:presentation_releases, name: SCOPED_INDEX_NAME)
    add_index :presentation_releases, :render_digest, unique: true, name: INDEX_NAME unless index_exists?(:presentation_releases, name: INDEX_NAME)
  end
end
