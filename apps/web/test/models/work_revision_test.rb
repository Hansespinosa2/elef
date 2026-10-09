require "test_helper"

class WorkRevisionTest < ActiveSupport::TestCase
  setup do
    @workspace = Workspace.default
    @work = Presentation.create!(workspace: @workspace, title: "Revision Deck", source: "# Original")
  end

  test "validates required fields, reasons, and statuses" do
    valid_source = "# Valid"
    valid_digest = WorkRevision.digest(valid_source)
    revision = WorkRevision.new(
      workspace: @workspace,
      work: @work,
      source: valid_source,
      source_digest: valid_digest,
      reason: "checkpoint",
      status: "checkpoint"
    )
    assert revision.valid?

    # Invalid reason
    invalid_reason = revision.dup
    invalid_reason.reason = "invalid_reason"
    refute invalid_reason.valid?
    assert_includes invalid_reason.errors[:reason], "is not included in the list"

    # Invalid status
    invalid_status = revision.dup
    invalid_status.status = "invalid_status"
    refute invalid_status.valid?
    assert_includes invalid_status.errors[:status], "is not included in the list"

    # Mismatched source digest
    mismatched_digest = revision.dup
    mismatched_digest.source_digest = "wrong_digest"
    refute mismatched_digest.valid?
    assert_includes mismatched_digest.errors[:source_digest], "does not match source"
  end

  test "revisions are strictly immutable on update" do
    checkpoint = @work.latest_checkpoint
    assert checkpoint.persisted?

    assert_raises(ActiveRecord::ReadOnlyRecord) do
      checkpoint.update!(source: "# Mutated")
    end

    assert_raises(ActiveRecord::ReadOnlyRecord) do
      checkpoint.update!(status: "recovery")
    end
  end

  test "revisions are strictly immutable on delete" do
    checkpoint = @work.latest_checkpoint
    assert checkpoint.persisted?

    assert_raises(ActiveRecord::ReadOnlyRecord) do
      checkpoint.destroy!
    end
  end

  test "scopes filter by checkpoints, recoveries, and order by history" do
    initial = @work.latest_checkpoint

    recovery = WorkRevision.create!(
      workspace: @workspace,
      work: @work,
      source: "# Recovery draft",
      source_digest: WorkRevision.digest("# Recovery draft"),
      reason: "recovery",
      status: "recovery"
    )

    assert_includes WorkRevision.checkpoints, initial
    refute_includes WorkRevision.checkpoints, recovery

    assert_includes WorkRevision.recoveries, recovery
    refute_includes WorkRevision.recoveries, initial

    history = WorkRevision.where(work: @work).history
    assert_equal recovery.id, history.first.id
    assert_predicate initial, :checkpoint?
    assert_predicate recovery, :recovery?
  end
end
