class CreateActiveStorageVariantRecords < ActiveRecord::Migration[8.1]
  def change
    create_table :active_storage_variant_records do |t|
      t.belongs_to :blob, null: false, index: false, foreign_key: { to_table: :active_storage_blobs }
      t.string :variation_digest, null: false

      t.timestamps

      t.index %i[blob_id variation_digest], name: "index_active_storage_variant_records_uniqueness", unique: true
    end
  end
end
