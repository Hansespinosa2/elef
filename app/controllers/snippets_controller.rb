class SnippetsController < ApplicationController
  def index
    @query = params[:q].to_s
    @category = params[:category].to_s
    @snippets = Snippet.search(@query)
    @snippets = @snippets.select { |snippet| snippet.category == @category } if @category.present?
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
