class Presentation < Work
  WORK_TYPE = "presentation".freeze
  DEFAULT_SOURCE = "# Untitled presentation\n\nStart writing Markdown here.".freeze
  FORK_TYPES = %w[continuation inspiration].freeze

  default_scope { where(work_type: WORK_TYPE) }

  validates :fork_type, inclusion: { in: FORK_TYPES }, allow_nil: true
  validate :cannot_fork_from_itself

  def forked?
    parent_id.present?
  end

  def continuation?
    fork_type == "continuation"
  end

  def inspiration?
    fork_type == "inspiration"
  end

  def fork_as(type)
    raise ArgumentError, "Unsupported fork type" unless FORK_TYPES.include?(type.to_s)

    suffix = " (#{type.to_s.capitalize})"
    self.class.new(title: "#{title.truncate(120 - suffix.length)}#{suffix}", source: source,
      parent: self, fork_type: type, fork_source: source, fork_parent_title: title)
  end

  private

  def cannot_fork_from_itself
    errors.add(:parent, "cannot be itself") if parent_id.present? && parent_id == id
  end
end
