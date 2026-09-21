module DocumentLinks
  module Rewriter
    module_function

    def rewrite!(old_title, new_title)
      Document.find_each do |document|
        rewritten = DocumentLinks::Parser.rewrite(document.source, old_title, new_title)
        next if rewritten == document.source

        document.source = rewritten
        document.update_columns(source: rewritten, updated_at: Time.current)
      end
    end
  end
end
