class Workspace < ApplicationRecord
  DEFAULT_THEME = "match".freeze
  DEFAULT_TYPOGRAPHY = "book".freeze
  THEMES = %w[light dark match].freeze
  TYPOGRAPHIES = %w[book modern technical].freeze

  has_many :works, dependent: :destroy
  has_many :work_revisions, dependent: :delete_all
  has_many :document_aliases, dependent: :destroy
  has_many :snippets, dependent: :destroy
  has_many :math_shortcuts, dependent: :destroy

  validates :name, :slug, presence: true
  validates :slug, uniqueness: true

  before_validation :ensure_settings

  scope :system, -> { where(system: true) }

  def self.default
    find_or_create_by!(slug: "default") do |workspace|
      workspace.name = "Default workspace"
      workspace.system = true
    end
  rescue ActiveRecord::RecordNotUnique
    find_by!(slug: "default")
  end

  def default_theme
    value = settings["theme"].to_s
    THEMES.include?(value) ? value : DEFAULT_THEME
  end

  alias theme default_theme

  def default_typography
    value = settings["typography"].to_s
    TYPOGRAPHIES.include?(value) ? value : DEFAULT_TYPOGRAPHY
  end

  alias typography default_typography

  def settings
    raw = self[:settings]
    return raw if raw.is_a?(Hash)

    JSON.parse(raw.presence || "{}")
  rescue JSON::ParserError, TypeError
    {}
  end

  def settings=(value)
    self[:settings] = value.to_h.to_json
  end

  def update_style_defaults(theme:, typography:)
    self.settings = settings.merge(
      "theme" => THEMES.include?(theme.to_s) ? theme.to_s : DEFAULT_THEME,
      "typography" => TYPOGRAPHIES.include?(typography.to_s) ? typography.to_s : DEFAULT_TYPOGRAPHY
    )
    save!
  end

  private

  def ensure_settings
    self[:settings] = "{}" if self[:settings].blank?
  end
end
