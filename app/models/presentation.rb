class Presentation < ApplicationRecord
  DEFAULT_SOURCE = "# Untitled presentation\n\nStart writing Markdown here.".freeze

  before_validation :normalize_source
  before_validation :derive_title, if: -> { title.blank? }

  validates :title, presence: true, length: { maximum: 120 }

  scope :recent_first, -> { order(updated_at: :desc, id: :desc) }

  def document
    @document ||= Presentations::Document.parse(source.to_s, source_name: title)
  end

  def slides
    document.slides
  end

  def presentation_theme
    document.presentation_theme
  end

  def source=(value)
    @document = nil
    super
  end

  def title=(value)
    @document = nil
    super
  end

  private

  def normalize_source
    self.source = source.to_s
  end

  def derive_title
    self.title = Presentations::Document.normalize_folder_name(
      Presentations::Document.extract_first_h1(source.to_s),
      fallback: "Untitled presentation"
    )
  end
end
