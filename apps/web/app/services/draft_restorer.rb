class DraftRestorer
  Result = Data.define(:work, :revision)

  def self.call(work, revision)
    new(work, revision).call
  end

  def initialize(work, revision)
    @work = work
    @revision = revision
  end

  def call
    raise ActiveRecord::RecordNotFound unless @revision && @revision.work_id == @work.id

    result = Drafts::Save.call(
      @work,
      source: @revision.source,
      lock_version: @work.lock_version,
      base_revision: @work.revision_token,
      checkpoint: true,
      reason: "restore",
      edit_session_id: "restore"
    )
    raise ActiveRecord::RecordInvalid, @work if result.invalid?
    raise ActiveRecord::StaleObjectError.new(@work, "restore") if result.conflict?

    Result.new(@work, result.checkpoint)
  end
end

RevisionRestorer = DraftRestorer
