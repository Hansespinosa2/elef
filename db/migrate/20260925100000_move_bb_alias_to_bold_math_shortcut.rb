require "json"

class MoveBbAliasToBoldMathShortcut < ActiveRecord::Migration[8.1]
  def up
    update_aliases(from: "Blackboard bold", to: "Bold")
  end

  def down
    update_aliases(from: "Bold", to: "Blackboard bold")
  end

  private

  def update_aliases(from:, to:)
    rows = connection.select_all(<<~SQL)
      SELECT id, workspace_id, name, aliases
      FROM math_shortcuts
      WHERE built_in = #{connection.quoted_true}
        AND prefix = #{connection.quote(".")}
        AND name IN (#{connection.quote(from)}, #{connection.quote(to)})
    SQL

    rows.group_by { |row| row["workspace_id"] }.each_value do |workspace_rows|
      aliases_by_name = workspace_rows.index_by { |row| row["name"] }
      source = aliases_by_name[from]
      destination = aliases_by_name[to]
      next unless source && destination

      source_aliases = JSON.parse(source["aliases"] || "[]") - ["bb"]
      destination_aliases = (JSON.parse(destination["aliases"] || "[]") + ["bb"]).uniq
      update_row(source["id"], source_aliases)
      update_row(destination["id"], destination_aliases)
    end
  end

  def update_row(id, aliases)
    connection.execute(<<~SQL)
      UPDATE math_shortcuts
      SET aliases = #{connection.quote(aliases.to_json)}
      WHERE id = #{connection.quote(id)}
    SQL
  end
end
