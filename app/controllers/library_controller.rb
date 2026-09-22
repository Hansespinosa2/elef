class LibraryController < ApplicationController
  def index
    @filter = "all"
    @works = Work.includes(:parent).recent_first
    @lineage_presentations = []
  end
end
