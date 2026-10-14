class SnippetsController < ApplicationController
  def index
    respond_to do |format|
      format.html { render template: "shared/settings_page", locals: { settings_page_title: "Snippets" } }
      format.json do
        records = Snippet.all.index_by { |snippet| snippet.id.to_s }
        entries = Snippets::Catalog.for_editor.map do |attributes|
          entry = attributes.stringify_keys
          record = records[entry["id"].to_s]
          entry.merge("built_in" => record ? record.built_in? : true)
        end
        render json: { entries: entries }
      end
    end
  end

  def new
    @snippet = Snippet.new(category: "Markdown")
    render template: "shared/settings_page", locals: { settings_page_title: "New snippet" }
  end

  def create
    @snippet = Snippet.new(snippet_params)
    if @snippet.save
      respond_to do |format|
        format.html { redirect_to snippets_path, notice: "Snippet created." }
        format.json { render json: { entry: authoring_entry(@snippet) }, status: :created }
      end
    else
      respond_to do |format|
        format.html { redirect_to snippets_path, alert: @snippet.errors.full_messages.to_sentence }
        format.json { render json: { code: "invalid_input" }, status: :unprocessable_content }
      end
    end
  end

  def edit
    @snippet = personal_snippet
    render template: "shared/settings_page", locals: { settings_page_title: "Edit #{@snippet.name}" }
  end

  def update
    @snippet = personal_snippet
    if @snippet.update(snippet_params)
      respond_to do |format|
        format.html { redirect_to snippets_path, notice: "Snippet saved." }
        format.json { render json: { entry: authoring_entry(@snippet) } }
      end
    else
      respond_to do |format|
        format.html { redirect_to snippets_path, alert: @snippet.errors.full_messages.to_sentence }
        format.json { render json: { code: "invalid_input" }, status: :unprocessable_content }
      end
    end
  end

  def destroy
    @snippet = personal_snippet
    @snippet.destroy!
    respond_to do |format|
      format.html { redirect_to snippets_path, notice: "Snippet deleted." }
      format.json { head :no_content }
    end
  end

  private

  def personal_snippet
    Snippet.personal.find(params[:id])
  end

  def snippet_params
    params.require(:snippet).permit(:name, :trigger, :description, :category, :body)
  end

  def authoring_entry(snippet)
    snippet.attributes.slice("id", "name", "trigger", "description", "category", "body", "built_in")
  end
end
