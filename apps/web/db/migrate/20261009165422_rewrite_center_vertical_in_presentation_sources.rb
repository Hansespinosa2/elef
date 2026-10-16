class RewriteCenterVerticalInPresentationSources < ActiveRecord::Migration[8.1]
  def up
    update_sources(direction: :up)
  end

  def down
    update_sources(direction: :down)
  end

  private

  def update_sources(direction:)
    rows = connection.select_all(<<~SQL)
      SELECT id, source
      FROM works
      WHERE kind = 'presentation'
        AND source LIKE '%:::align{%'
    SQL

    rows.each do |row|
      source = row["source"]
      rewritten = rewrite_source(source, direction: direction)
      next if rewritten == source

      connection.execute(<<~SQL)
        UPDATE works
        SET source = #{connection.quote(rewritten)}
        WHERE id = #{connection.quote(row["id"])}
      SQL
    end
  end

  def rewrite_source(source, direction:)
    return source unless source.include?(":::align")

    lines = source.split(/\r\n|\r|\n/, -1)
    ending = (source =~ /\r\n/ ? "\r\n" : "\n")
    fence = nil

    rewritten = lines.map do |line|
      if (match = line.match(/\A\s{0,3}(`{3,}|~{3,})(.*)\z/))
        marker = { marker: match[1][0], length: match[1].length, closing: match[2].match?(/\A[ \t]*\z/) }
        if fence.nil?
          fence = marker
        elsif fence[:marker] == marker[:marker] && marker[:length] >= fence[:length] && marker[:closing]
          fence = nil
        end
        line
      elsif fence.nil?
        if direction == :up && line.match?(/\A\s*:::align\{center\s+(left|center|right)\}\s*\z/)
          line.sub(/(:::align\{)center(\s+(?:left|center|right)\})/, "\\1middle\\2")
        elsif direction == :down && line.match?(/\A\s*:::align\{middle\s+(left|center|right)\}\s*\z/)
          line.sub(/(:::align\{)middle(\s+(?:left|center|right)\})/, "\\1center\\2")
        else
          line
        end
      else
        line
      end
    end

    rewritten.join(ending)
  end
end
