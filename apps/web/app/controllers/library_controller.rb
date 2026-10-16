class LibraryController < ApplicationController
  def index
    @filter = "all"
    @card_notes = {}
    @lineage_presentations = []
    render :shell
  end

  def search
    query = params[:q].to_s
    type = params[:type].to_s.downcase
    type = nil unless WorkSearch::WORK_TYPES.key?(type)

    render json: {
      query: query,
      type: type || "all",
      results: WorkSearch.call(query, limit: params[:limit] || WorkSearch::DEFAULT_LIMIT, type: type)
    }
  end
end
