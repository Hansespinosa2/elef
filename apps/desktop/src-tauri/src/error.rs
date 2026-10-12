use local_store::CoreError;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub(crate) struct CommandError {
    pub(crate) code: &'static str,
    message: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl CommandError {
    pub(crate) fn new(code: &'static str, message: &str, retryable: bool) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
            details: None,
        }
    }

    pub(crate) fn with_details(
        code: &'static str,
        message: &str,
        retryable: bool,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
            details: Some(details),
        }
    }
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Conflict {
                disk_hash,
                disk_source,
                disk_source_file,
            } => Self {
                code: "conflict",
                message: "The file changed outside Elef. Review the current version before saving."
                    .into(),
                retryable: false,
                details: Some(serde_json::json!({
                    "disk_hash": disk_hash,
                    "current": { "source": disk_source, "source_file": disk_source_file }
                })),
            },
            CoreError::AuthoringConflict => Self::new(
                "conflict",
                "Authoring settings changed outside Elef. Close and reopen settings before saving.",
                false,
            ),
            CoreError::ImportConflict {
                incoming_name,
                existing_name,
            } => Self::with_details(
                "import_conflict",
                "A Work with this identity already exists.",
                false,
                serde_json::json!({
                    "incoming_name": incoming_name,
                    "existing_name": existing_name
                }),
            ),
            other => Self {
                code: other.code(),
                message: other.to_string(),
                // A work folder path that vanishes mid-session (sync tools, transient
                // unmounts) must retry on the capped backoff like any IO
                // failure instead of wedging the saver in a manual-retry
                // state that quiet-save no longer offers.
                retryable: matches!(other, CoreError::Io(_) | CoreError::NotFound),
                details: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_storage_errors_are_retryable_and_input_errors_are_not() {
        let retryable = CommandError::from(CoreError::NotFound);
        assert_eq!(retryable.code, "not_found");
        assert!(retryable.retryable);
        let fatal = CommandError::from(CoreError::InvalidInput);
        assert_eq!(fatal.code, "invalid_input");
        assert!(!fatal.retryable);
    }

    #[test]
    fn conflict_errors_have_the_adapter_shape_and_preserve_current_source() {
        let error = CommandError::from(CoreError::Conflict {
            disk_hash: "a".repeat(64),
            disk_source: "outside edit".into(),
            disk_source_file: "presentation.md".into(),
        });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "conflict");
        assert_eq!(value["retryable"], false);
        assert_eq!(value["details"]["current"]["source"], "outside edit");
        assert_eq!(
            value["details"]["current"]["source_file"],
            "presentation.md"
        );
    }
}
