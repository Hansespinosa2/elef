module Drafts
  class Save
    Result = Data.define(
      :status,
      :work,
      :checkpoint,
      :recovery_revision,
      :errors,
      :message
    ) do
      def success?
        status == :saved
      end

      def conflict?
        status == :conflict
      end

      def invalid?
        status == :invalid
      end
    end

    def self.call(work, attributes = {})
      new(work, attributes).call
    end

    def initialize(work, attributes)
      @work = work
      @attributes = attributes.to_h.symbolize_keys
    end

    def call
      @work.with_lock do
        submitted_source = submitted_source_value
        unless submitted_source.is_a?(String)
          return invalid_result(["Markdown source must be plain text"])
        end

        if stale_submission?
          return conflict_result(submitted_source)
        end

        assign_attributes(submitted_source)
        return invalid_result(@work.errors.full_messages) unless @work.valid?

        @work.save!
        checkpoint = create_checkpoint_if_needed
        Result.new(:saved, @work, checkpoint, nil, [], nil)
      end
    rescue ActiveRecord::StaleObjectError
      @work.reload
      conflict_result(submitted_source_value)
    rescue ActiveRecord::RecordInvalid => error
      invalid_result(error.record.errors.full_messages)
    end

    private

    def submitted_source_value
      @attributes.key?(:source) ? @attributes[:source] : @work.source.to_s
    end

    def submitted_lock_version
      value = @attributes[:lock_version]
      value.present? ? value.to_i : nil
    end

    def submitted_base_revision
      @attributes[:base_revision].presence || @attributes[:revision_token].presence || @attributes[:base_revision_id].presence
    end

    def stale_submission?
      lock_version = submitted_lock_version
      return true if lock_version && lock_version != @work.lock_version

      token = submitted_base_revision
      return false if token.blank?
      return false if token == @work.revision_token
      current_revision = @work.current_revision
      return false if current_revision && token.to_s == current_revision.id.to_s && current_revision.source_digest == @work.draft_digest

      true
    end

    def assign_attributes(source)
      @work.title = @attributes[:title] if @attributes.key?(:title)
      @work.source = source
      @work.theme = @attributes[:theme] if @attributes.key?(:theme)
      @work.typography = @attributes[:typography] if @attributes.key?(:typography)
    end

    def explicit_checkpoint?
      ActiveModel::Type::Boolean.new.cast(@attributes[:checkpoint]) ||
        %w[restore fork-origin publish import].include?(@attributes[:reason].to_s)
    end

    def checkpoint_reason
      reason = @attributes[:reason].to_s
      %w[checkpoint restore fork-origin publish import].include?(reason) ? reason : "checkpoint"
    end

    def create_checkpoint_if_needed
      return @work.latest_checkpoint unless explicit_checkpoint? || @work.checkpoint_due?

      @work.association(:latest_checkpoint).reset
      latest = @work.latest_checkpoint
      return latest if latest && latest.source_digest == @work.draft_digest && checkpoint_reason != "restore"

      revision = @work.work_revisions.create!(
        workspace: @work.workspace,
        parent_revision: latest,
        base_revision: revision_for(submitted_base_revision),
        source: @work.source.to_s,
        source_digest: @work.draft_digest,
        reason: checkpoint_reason,
        status: WorkRevision::STATUSES.include?(checkpoint_reason) ? checkpoint_reason : "checkpoint",
        edit_session_id: @attributes[:edit_session_id].presence
      )
      @work.update_columns(latest_checkpoint_id: revision.id)
      @work.association(:latest_checkpoint).target = revision
      revision
    end

    def revision_for(value)
      return unless value.to_s.match?(/\A\d+\z/)

      @work.work_revisions.find_by(id: value)
    end

    def conflict_result(source)
      return invalid_result(["Markdown source must be plain text"]) unless source.is_a?(String)

      @work.association(:latest_checkpoint).reset
      digest = WorkRevision.digest(source)
      recovery = @work.work_revisions.history.first
      recovery = nil unless recovery&.recovery? && recovery.source_digest == digest
      recovery ||= @work.work_revisions.create!(
        workspace: @work.workspace,
        parent_revision: @work.latest_checkpoint,
        base_revision: revision_for(submitted_base_revision),
        source: source,
        source_digest: digest,
        reason: "recovery",
        status: "recovery",
        edit_session_id: @attributes[:edit_session_id].presence,
        metadata: {
          title: @attributes[:title].presence,
          submitted_lock_version: @attributes[:lock_version],
          submitted_base_revision: submitted_base_revision
        }
      )
      Result.new(
        :conflict,
        @work,
        @work.latest_checkpoint,
        recovery,
        [],
        "A newer version is active; your draft was preserved."
      )
    end

    def invalid_result(errors)
      Result.new(:invalid, @work, @work.latest_checkpoint, nil, Array(errors), nil)
    end
  end
end
