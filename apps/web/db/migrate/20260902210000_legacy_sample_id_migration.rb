class LegacySampleIdMigration < ActiveRecord::Migration[8.1]
  # The original sample-ID migration was moved to a later timestamp so fresh
  # databases create presentations before adding the column. Keep the old
  # version represented so databases that already applied it do not show a
  # missing migration after the rename.
end
