class LibraryController < ApplicationController
  def index
    @filter = "all"
    @works = Work.recent_first
    @lineage_presentations = []
  end
end
