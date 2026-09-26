require "securerandom"

class Work < ApplicationRecord
  self.table_name = "works"

  WORK_TYPES = %w[document presentation].freeze
  DEFAULT_SOURCE = "# Untitled work\n\nStart writing Markdown here.".freeze
  CHECKPOINT_INTERVAL = 30.seconds
  PREVIEW_PAGE_BLOCKS = 3
  PREVIEW_PAGE_CHARACTERS = 400

  belongs_to :workspace
  belongs_to :latest_checkpoint, class_name: "WorkRevision", optional: true
  belongs_to :published_release, class_name: "PresentationRelease", optional: true

  has_many :presentation_releases, dependent: :delete_all
  has_many :work_revisions, dependent: :delete_all
  alias_method :revisions, :work_revisions
  has_one :document_detail, dependent: :destroy
  has_one :presentation_detail, dependent: :destroy
  has_many :document_aliases, dependent: :destroy
  has_many_attached :assets

  before_validation :normalize_source
  before_validation :ensure_work_type
  before_validation :derive_title, if: -> { title.blank? }
  before_validation :ensure_workspace
  before_validation :ensure_created_at
  after_create :ensure_kind_details
  after_create :create_initial_revision
  after_create :persist_pending_lineage
  after_create :record_document_alias
  after_update :record_document_alias, if: :saved_change_to_title?
  before_destroy :clear_published_release_reference, prepend: true

  validates :title, presence: true, length: { maximum: 120 }
  validates :kind, inclusion: { in: WORK_TYPES }
  validate :work_type_matches_model

  scope :recent_first, -> { order(updated_at: :desc, id: :desc) }
  scope :presentations, -> { where(kind: "presentation") }
  scope :documents, -> { where(kind: "document") }

  def presentation?
    kind == "presentation"
  end

  def document?
    kind == "document"
  end

  def parent
    return unless presentation?

    PresentationLineageEdge.find_by(child_work_id: id)&.parent_work
  end

  def fork_type
    return unless presentation?

    PresentationLineageEdge.find_by(child_work_id: id)&.fork_type
  end

  def fork_parent_title
    return unless presentation?

    edge = PresentationLineageEdge.find_by(child_work_id: id)
    edge&.parent_title_snapshot || edge&.parent_work&.title
  end

  def work_type
    kind
  end

  def work_type=(value)
    self.kind = value
  end

  def parsed_document(source_override = nil)
    if source_override
      return Presentations::Document.parse(
        source_override.to_s,
        source_name: title.presence || default_title,
        mode: kind.to_sym
      )
    end

    @parsed_document ||= Presentations::Document.parse(
      source.to_s,
      source_name: title.presence || default_title,
      mode: kind.to_sym
    )
  end

  alias document parsed_document

  def slides
    parsed_document.slides
  end

  def blocks
    slides.flat_map(&:blocks)
  end

  def theme
    Presentations::Document.style_overrides(source)[:theme] || workspace_style_defaults[:theme]
  end

  def typography
    Presentations::Document.style_overrides(source)[:typography] || workspace_style_defaults[:typography]
  end

  def theme_override
    Presentations::Document.style_overrides(source)[:theme]
  end

  def typography_override
    Presentations::Document.style_overrides(source)[:typography]
  end

  def theme=(value)
    self.source = Presentations::Document.with_front_matter_value(
      source.to_s,
      "theme",
      value.blank? ? nil : Presentations::Document.normalize_theme_value(value)
    )
  end

  def typography=(value)
    self.source = Presentations::Document.with_front_matter_value(
      source.to_s,
      "typography",
      value.blank? ? nil : Presentations::Document.normalize_typography_value(value)
    )
  end

  def preview_warnings
    parsed_document.warnings
  end

  def preview_html
    preview_workspace = workspace || Workspace.default
    Presentations::DocumentRenderer.render(
      source,
      source_name: title,
      parsed: parsed_document,
      documents: Document.where(workspace: preview_workspace),
      workspace: preview_workspace,
      media_resolver: Presentations::MediaAssets.resolver_for(self)
    )
  end

  def preview_page_html(blocks: PREVIEW_PAGE_BLOCKS, characters: PREVIEW_PAGE_CHARACTERS)
    page = parsed_document.slides.first
    return "".html_safe unless page

    preview_workspace = workspace || Workspace.default
    linked_documents = Document.where(workspace: preview_workspace).to_a
    rendered = +""
    rendered_length = 0

    page.blocks.each_with_index do |block, index|
      markdown = block.markdown.to_s
      break if index.positive? && (index >= blocks || rendered_length + markdown.length > characters)

      rendered_length += markdown.length
      rendered << DocumentLinks::Renderer.render(markdown, documents: linked_documents, workspace: preview_workspace)
    end

    rendered.html_safe
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

  def draft_digest
    WorkRevision.digest(source)
  end

  def revision_token
    "#{lock_version}:#{draft_digest}"
  end

  def published_release_status
    return "unpublished" unless presentation? && published_release

    published_release.stale? ? "stale" : "current"
  end

  def current_revision
    latest_checkpoint || work_revisions.checkpoints.order(id: :desc).first
  end

  def checkpoint_due?
    latest_checkpoint.blank? || latest_checkpoint.updated_at <= CHECKPOINT_INTERVAL.ago
  end

  def set_initial_revision_metadata(reason:, metadata: {})
    @initial_revision_reason = reason
    @initial_revision_metadata = metadata
  end

  def initial_revision_reason
    @initial_revision_reason || "checkpoint"
  end

  def initial_revision_metadata
    @initial_revision_metadata || {}
  end

  def source_digest
    draft_digest
  end

  private

  def workspace_style_defaults
    current_workspace = workspace || Workspace.default
    { theme: current_workspace.default_theme, typography: current_workspace.default_typography }
  end

  def normalize_source
    self.source = source.to_s
  end

  def ensure_created_at
    self.created_at ||= Time.current
  end

  def ensure_workspace
    self.workspace ||= Workspace.default
  end

  def ensure_work_type
    self.kind = expected_work_type if kind.blank? && expected_work_type.present?
    self.kind ||= "presentation"
  end

  def expected_work_type
    self.class.const_defined?(:WORK_TYPE, false) ? self.class::WORK_TYPE : nil
  end

  def work_type_matches_model
    return if expected_work_type.blank? || kind == expected_work_type

    errors.add(:kind, "must be #{expected_work_type} for this work type")
  end

  def derive_title
    self.title = Presentations::Document.normalize_folder_name(
      Presentations::Document.extract_first_h1(source.to_s),
      fallback: default_title
    )
  end

  def ensure_kind_details
    if document?
      DocumentDetail.create!(work: self, document_key: SecureRandom.uuid)
    else
      detail = PresentationDetail.create!(work: self, settings: {})
      detail.update!(sample_id: sample_id) if respond_to?(:sample_id) && sample_id.present?
    end
  end

  def create_initial_revision
    reason = initial_revision_reason
    revision = work_revisions.create!(
      workspace: workspace,
      source: source.to_s,
      source_digest: draft_digest,
      reason: reason,
      status: WorkRevision::STATUSES.include?(reason) ? reason : "checkpoint",
      metadata: initial_revision_metadata
    )
    update_columns(latest_checkpoint_id: revision.id, updated_at: updated_at)
  end

  def persist_pending_lineage
    return unless presentation? && respond_to?(:pending_lineage_parent, true)
    return unless pending_lineage_parent

    PresentationLineageEdge.create!(
      parent_work: pending_lineage_parent,
      child_work: self,
      origin_revision: if respond_to?(:pending_lineage_origin_revision, true)
        pending_lineage_origin_revision || latest_checkpoint
      else
        latest_checkpoint
      end,
      fork_type: pending_lineage_type,
      parent_title_snapshot: pending_lineage_parent.title,
      origin_source_snapshot: if respond_to?(:pending_lineage_origin_revision, true)
        (pending_lineage_origin_revision || latest_checkpoint)&.source
      else
        latest_checkpoint&.source
      end
    )
  end

  def record_document_alias
    return unless document? && workspace && title.present?

    DocumentAlias.find_or_create_by!(workspace: workspace, work: self, alias_name: title)
  end

  def clear_published_release_reference
    update_columns(published_release_id: nil) if published_release_id.present?
  end
end
