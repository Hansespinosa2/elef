class WorkspaceSettingsController < ApplicationController
  before_action :set_workspace

  def show
    render template: "shared/settings_page", locals: { settings_page_title: "Settings" }
  end

  def update
    settings = params.require(:workspace).permit(:theme, :typography)
    @workspace.update_style_defaults(
      theme: settings.fetch(:theme, @workspace.default_theme),
      typography: settings.fetch(:typography, @workspace.default_typography)
    )

    respond_to do |format|
      format.html { redirect_to settings_path, notice: "Workspace appearance saved." }
      format.json { render json: { theme: @workspace.default_theme, typography: @workspace.default_typography } }
    end
  rescue ActiveRecord::RecordInvalid
    respond_to do |format|
      format.html { redirect_to settings_path, alert: "Choose a valid workspace appearance." }
      format.json { render json: { error: "Choose a valid workspace appearance." }, status: :unprocessable_content }
    end
  end

  private

  def set_workspace
    @workspace = Workspace.default
  end
end
