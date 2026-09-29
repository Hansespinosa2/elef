class Presentation < Work
  WORK_TYPE = "presentation".freeze
  DEFAULT_SOURCE = <<~MARKDOWN.chomp.freeze
    :::align{center center}
    # Untitled Document

    :::align {center}
    Start writing Markdown here.
  MARKDOWN
  FORK_TYPES = PresentationLineageEdge::FORK_TYPES

  default_scope { where(kind: WORK_TYPE) }

  class << self
    def find_by(attributes = nil, *args)
      return super unless attributes.respond_to?(:key?)

      attributes = attributes.to_h.symbolize_keys
      if attributes.key?(:sample_id)
        sample_id = attributes.delete(:sample_id)
        relation = joins(:presentation_detail).where(presentation_details: { sample_id: sample_id })
        return relation.find_by(attributes, *args)
      end
      if attributes.keys.any? { |key| %i[parent_id fork_type].include?(key) }
        has_parent_filter = attributes.key?(:parent_id)
        has_fork_filter = attributes.key?(:fork_type)
        parent_filter = attributes.delete(:parent_id) if has_parent_filter
        fork_filter = attributes.delete(:fork_type) if has_fork_filter
        relation = joins("LEFT JOIN presentation_lineage_edges AS lineage_edges ON lineage_edges.child_work_id = works.id")
        relation = if parent_filter.nil? && has_parent_filter
          relation.where("lineage_edges.parent_work_id IS NULL")
        elsif has_parent_filter
          relation.where(lineage_edges: { parent_work_id: parent_filter })
        else
          relation
        end
        relation = relation.where(lineage_edges: { fork_type: fork_filter }) if has_fork_filter
        return relation.find_by(attributes, *args)
      end

      super
    end

    def find_by!(attributes = nil, *args)
      if attributes.respond_to?(:key?) && attributes.to_h.keys.map(&:to_sym).any? { |key| %i[sample_id parent_id fork_type].include?(key) }
        record = find_by(attributes, *args)
        return record if record

        raise ActiveRecord::RecordNotFound, "Couldn't find Presentation with #{attributes.inspect}"
      end

      super
    end
  end

  validate :cannot_fork_from_itself
  validate :fork_type_is_supported

  after_save :sync_storage_folder
  after_destroy :remove_storage_folder

  def sync_storage_folder
    Presentations::FolderSync.sync!(self)
  end

  def remove_storage_folder
    Presentations::FolderSync.remove!(self)
  end

  def storage_dir
    Presentations::FolderSync.presentation_dir(self)
  end

  def presentation_detail_record
    presentation_detail
  end

  def last_published_at
    published_release&.published_at
  end

  def sample_id
    @sample_id || self[:sample_id] || presentation_detail&.sample_id
  end

  def sample_id=(value)
    @sample_id = value
    self[:sample_id] = value if has_attribute?(:sample_id)
    if presentation_detail
      presentation_detail.sample_id = value
      presentation_detail.save! if presentation_detail.persisted? && presentation_detail.changed?
    end
  end

  def parent
    return @pending_lineage_parent if !persisted? && defined?(@pending_lineage_parent)

    edge = lineage_edge
    edge && Presentation.find_by(id: edge.parent_work_id)
  end

  def parent=(work)
    @pending_lineage_parent = work
  end

  def parent_id
    parent&.id
  end

  def children
    Presentation.where(id: PresentationLineageEdge.where(parent_work_id: id).select(:child_work_id))
  end

  def lineage_edge
    return unless persisted?

    @lineage_edge ||= PresentationLineageEdge.includes(:parent_work, :origin_revision).find_by(child_work_id: id)
  end

  def reload(*)
    @lineage_edge = nil
    @sample_id = nil
    super
  end

  def fork_type
    return @pending_fork_type if !persisted? && @pending_fork_type

    lineage_edge&.fork_type || @pending_fork_type
  end

  def fork_type=(value)
    @pending_fork_type = value
  end

  def fork_source
    edge = lineage_edge
    edge&.origin_source_snapshot.presence || edge&.origin_revision&.source
  end

  def fork_parent_title
    lineage_edge&.parent_title_snapshot || lineage_edge&.parent_work&.title
  end

  def forked?
    parent_id.present? || @pending_lineage_parent.present?
  end

  def continuation?
    fork_type == "continuation"
  end

  def inspiration?
    fork_type == "inspiration"
  end

  def fork_as(type)
    type = type.to_s
    raise ArgumentError, "Unsupported fork type" unless FORK_TYPES.include?(type)
    raise ArgumentError, "Cannot fork a presentation from itself" if persisted? && id == parent_id

    origin_revision = ensure_fork_origin_revision
    suffix = " (#{type.capitalize})"
    child = self.class.new(
      title: "#{title.truncate(120 - suffix.length)}#{suffix}",
      source: origin_revision.source,
      workspace: workspace
    )
    child.parent = self
    child.fork_type = type
    child.set_initial_revision_metadata(
      reason: "fork-origin",
      metadata: { parent_work_id: id, origin_revision_id: origin_revision.id, fork_type: type }
    )
    child.send(:set_pending_lineage_origin_revision, origin_revision)
    child
  end

  def pending_lineage_parent
    @pending_lineage_parent
  end

  def pending_lineage_type
    @pending_fork_type || "continuation"
  end

  def pending_lineage_origin_revision
    @pending_lineage_origin_revision
  end

  private

  def set_pending_lineage_origin_revision(revision)
    @pending_lineage_origin_revision = revision
  end

  def ensure_fork_origin_revision
    return latest_checkpoint if latest_checkpoint && latest_checkpoint.source == source

    revision = work_revisions.create!(
      workspace: workspace,
      parent_revision: latest_checkpoint,
      source: source.to_s,
      source_digest: draft_digest,
      reason: "checkpoint",
      status: "checkpoint"
    )
    update_columns(latest_checkpoint_id: revision.id)
    revision
  end

  def cannot_fork_from_itself
    errors.add(:parent, "cannot be itself") if @pending_lineage_parent == self
  end

  def fork_type_is_supported
    return if fork_type.blank? || FORK_TYPES.include?(fork_type)

    errors.add(:fork_type, "is not supported")
  end
end
