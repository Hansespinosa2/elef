class MathShortcutsController < ApplicationController
  before_action :set_shortcut, only: %i[edit update destroy]

  def index
    @math_shortcuts = MathShortcuts::Catalog.for_ui
  end

  def new
    @math_shortcut = MathShortcut.new(prefix: ".", aliases: [])
  end

  def create
    @math_shortcut = MathShortcut.new(math_shortcut_params.merge(workspace: Workspace.default, built_in: false))
    if @math_shortcut.save
      redirect_to math_shortcuts_path, notice: "Math shortcut created."
    else
      render :new, status: :unprocessable_content
    end
  end

  def edit
    return redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only." if @math_shortcut.built_in?
  end

  def update
    if @math_shortcut.built_in?
      redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only."
    elsif @math_shortcut.update(math_shortcut_params)
      redirect_to math_shortcuts_path, notice: "Math shortcut updated."
    else
      render :edit, status: :unprocessable_content
    end
  end

  def destroy
    if @math_shortcut.built_in?
      redirect_to math_shortcuts_path, alert: "Built-in math shortcuts are read-only."
    else
      @math_shortcut.destroy!
      redirect_to math_shortcuts_path, notice: "Math shortcut deleted."
    end
  end

  private

  def set_shortcut
    @math_shortcut = MathShortcut.where(workspace: Workspace.default).find(params[:id])
  end

  def math_shortcut_params
    params.require(:math_shortcut).permit(:name, :aliases, :description, :prefix, :expansion)
  end
end
