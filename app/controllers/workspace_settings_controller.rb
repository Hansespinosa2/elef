class WorkspaceSettingsController < ApplicationController
  before_action :set_workspace

  def show
  end

  def update
    settings = params.require(:workspace).permit(:theme, :typography)
    @workspace.update_style_defaults(theme: settings[:theme], typography: settings[:typography])
    redirect_to settings_path, notice: "Workspace appearance saved."
  rescue ActiveRecord::RecordInvalid
    redirect_to settings_path, alert: "Choose a valid workspace appearance."
  end

  private

  def set_workspace
    @workspace = Workspace.default
  end
end
