class SnippetsController < ApplicationController
  def index
    @query = params[:q].to_s
    @category = params[:category].to_s
    matching_snippets = Snippet.search(@query)
    @snippet_category_counts = matching_snippets.group_by(&:category).transform_values(&:size)
    @snippets = matching_snippets
    @snippets = @snippets.select { |snippet| snippet.category == @category } if @category.present?
    @snippet_groups = Snippet::CATEGORIES.filter_map do |category|
      snippets = @snippets.select { |snippet| snippet.category == category }
      [category, snippets] if snippets.any?
    end
  end

  def new
    @snippet = Snippet.new(category: "Markdown")
  end

  def create
    @snippet = Snippet.new(snippet_params)
    if @snippet.save
      redirect_to snippets_path, notice: "Snippet created."
    else
      render :new, status: :unprocessable_content
    end
  end

  def edit
    @snippet = personal_snippet
  end

  def update
    @snippet = personal_snippet
    if @snippet.update(snippet_params)
      redirect_to snippets_path, notice: "Snippet saved."
    else
      render :edit, status: :unprocessable_content
    end
  end

  def destroy
    @snippet = personal_snippet
    @snippet.destroy!
    redirect_to snippets_path, notice: "Snippet deleted."
  end

  private

  def personal_snippet
    Snippet.personal.find(params[:id])
  end

  def snippet_params
    params.require(:snippet).permit(:name, :trigger, :description, :category, :body)
  end
end
