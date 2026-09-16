class Work < ApplicationRecord
  self.table_name = "presentations"

  WORK_TYPES = %w[document presentation].freeze
  DEFAULT_SOURCE = "# Untitled work\n\nStart writing Markdown here.".freeze

  before_validation :normalize_source
  before_validation :ensure_work_type
  before_validation :derive_title, if: -> { title.blank? }
  before_validation :ensure_created_at

  validates :title, presence: true, length: { maximum: 120 }
  validates :work_type, inclusion: { in: WORK_TYPES }
  validate :work_type_matches_model

  belongs_to :parent, class_name: "Presentation", optional: true, inverse_of: :children
  has_many :children, class_name: "Presentation", foreign_key: :parent_id,
    dependent: :nullify, inverse_of: :parent

  scope :recent_first, -> { order(updated_at: :desc, id: :desc) }
  scope :presentations, -> { where(work_type: "presentation") }
  scope :documents, -> { where(work_type: "document") }

  def presentation?
    work_type == "presentation"
  end

  def document?
    work_type == "document"
  end

  def parsed_document
    @parsed_document ||= Presentations::Document.parse(
      source.to_s,
      source_name: title.presence || default_title,
      mode: work_type.to_sym
    )
  end

  alias document parsed_document

  def slides
    parsed_document.slides
  end

  def blocks
    slides.flat_map(&:blocks)
  end

  def presentation_theme
    parsed_document.presentation_theme
  end

  def presentation_typography
    parsed_document.presentation_typography
  end

  def presentation_typography=(value)
    self.source = Presentations::Document.with_front_matter_value(
      source.to_s,
      "presentationTypography",
      Presentations::Document.normalize_typography_value(value)
    )
  end

  def preview_warnings
    parsed_document.warnings
  end

  def source=(value)
    @parsed_document = nil
    super
  end

  def title=(value)
    @parsed_document = nil
    super
  end

  def default_title
    document? ? "Untitled document" : "Untitled presentation"
  end

  private

  def normalize_source
    self.source = source.to_s
  end

  def ensure_created_at
    self.created_at ||= Time.current
  end

  def ensure_work_type
    self.work_type = expected_work_type if work_type.blank? && expected_work_type.present?
    self.work_type ||= "presentation"
  end

  def expected_work_type
    self.class.const_defined?(:WORK_TYPE, false) ? self.class::WORK_TYPE : nil
  end

  def work_type_matches_model
    return if expected_work_type.blank? || work_type == expected_work_type

    errors.add(:work_type, "must be #{expected_work_type} for this work type")
  end

  def derive_title
    self.title = Presentations::Document.normalize_folder_name(
      Presentations::Document.extract_first_h1(source.to_s),
      fallback: default_title
    )
  end
end
