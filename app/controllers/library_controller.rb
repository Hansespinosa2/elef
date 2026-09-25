class LibraryController < ApplicationController
  def index
    @filter = "all"
    @works = Work.recent_first
    @lineage_presentations = []
  end

  def search
    query = params[:q].to_s
    render json: { query: query, results: WorkSearch.call(query, limit: params[:limit] || WorkSearch::DEFAULT_LIMIT) }
  end
end
