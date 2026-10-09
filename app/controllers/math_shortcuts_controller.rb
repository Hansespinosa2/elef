class MathShortcutsController < ApplicationController
  before_action :set_shortcut, only: %i[edit update destroy]

  def index
    respond_to do |format|
      format.html
      format.json { render json: { entries: MathShortcuts::Catalog.for_editor } }
    end
  end

  def new
    @math_shortcut = MathShortcut.new(prefix: ".", aliases: [])
  end

  def create
    @math_shortcut = MathShortcut.new(math_shortcut_params.merge(workspace: Workspace.default, built_in: false))
    if @math_shortcut.save
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, notice: "Math shortcut created." }
        format.json { render json: { entry: authoring_entry(@math_shortcut) }, status: :created }
      end
    else
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, alert: @math_shortcut.errors.full_messages.to_sentence }
        format.json { render json: { code: "invalid_input" }, status: :unprocessable_content }
      end
    end
  end

  def edit
    return redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only." if @math_shortcut.built_in?
  end

  def update
    if @math_shortcut.built_in?
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only." }
        format.json { render json: { code: "unsupported" }, status: :forbidden }
      end
    elsif @math_shortcut.update(math_shortcut_params)
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, notice: "Math shortcut updated." }
        format.json { render json: { entry: authoring_entry(@math_shortcut) } }
      end
    else
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, alert: @math_shortcut.errors.full_messages.to_sentence }
        format.json { render json: { code: "invalid_input" }, status: :unprocessable_content }
      end
    end
  end

  def destroy
    if @math_shortcut.built_in?
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only." }
        format.json { render json: { code: "unsupported" }, status: :forbidden }
      end
    else
      @math_shortcut.destroy!
      respond_to do |format|
        format.html { redirect_to math_shortcuts_path, notice: "Math shortcut deleted." }
        format.json { head :no_content }
      end
    end
  end

  private

  def set_shortcut
    @math_shortcut = MathShortcut.where(workspace: Workspace.default).find(params[:id])
  end

  def math_shortcut_params
    values = params.require(:math_shortcut)
    permitted = values.permit(:name, :description, :prefix, :expansion, aliases: [])
    permitted[:aliases] = values[:aliases] if values[:aliases].is_a?(String)
    permitted
  end

  def authoring_entry(shortcut)
    shortcut.attributes.slice("id", "name", "aliases", "description", "prefix", "expansion", "built_in")
  end
end
