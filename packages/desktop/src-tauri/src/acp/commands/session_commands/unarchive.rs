use super::*;
use tokio::process::Command;

const CODEX_UNARCHIVE_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
#[specta::specta]
pub async fn acp_unarchive_session(app: AppHandle, session_id: String) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_unarchive_session",
        async {
            let db = app.state::<DbConn>();
            let metadata = SessionMetadataRepository::get_by_id(db.inner(), &session_id)
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!("Failed to load session metadata for unarchive: {error}"),
                })?;

            let Some(metadata) = metadata else {
                return Err(SerializableAcpError::SessionNotFound { session_id });
            };

            let agent_id =
                metadata
                    .agent_id_enum()
                    .ok_or_else(|| SerializableAcpError::InvalidState {
                        message: format!(
                            "Session {} is missing the agent id needed to unarchive",
                            metadata.history_session_id()
                        ),
                    })?;
            if agent_id != CanonicalAgentId::Codex {
                return Err(SerializableAcpError::InvalidState {
                    message: format!(
                    "Only Codex sessions can be unarchived through this recovery action; found {}",
                    agent_id.as_str()
                ),
                });
            }

            let thread_id = metadata.history_session_id().to_string();
            validate_codex_thread_id(&thread_id)?;

            let binary = crate::acp::agent_installer::get_cached_binary(&CanonicalAgentId::Codex)
                .ok_or_else(|| SerializableAcpError::InvalidState {
                message: "Codex managed binary is not installed.".to_string(),
            })?;

            let output = timeout(
                CODEX_UNARCHIVE_TIMEOUT,
                Command::new(&binary)
                    .arg("unarchive")
                    .arg(&thread_id)
                    .output(),
            )
            .await
            .map_err(|_| SerializableAcpError::InvalidState {
                message: format!(
                    "Codex unarchive timed out after {}s",
                    CODEX_UNARCHIVE_TIMEOUT.as_secs()
                ),
            })?
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!("Failed to run Codex unarchive: {error}"),
            })?;

            if !output.status.success() {
                return Err(SerializableAcpError::InvalidState {
                    message: format!(
                        "Codex unarchive failed: {}",
                        summarize_codex_unarchive_output(&output.stdout, &output.stderr)
                    ),
                });
            }

            Ok(())
        }
        .await,
    )
}

fn validate_codex_thread_id(thread_id: &str) -> Result<(), SerializableAcpError> {
    if thread_id.is_empty() {
        return Err(SerializableAcpError::InvalidState {
            message: "Codex thread id is empty.".to_string(),
        });
    }

    if thread_id.len() > 256 {
        return Err(SerializableAcpError::InvalidState {
            message: "Codex thread id is too long.".to_string(),
        });
    }

    if !thread_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(SerializableAcpError::InvalidState {
            message: "Codex thread id contains unsupported characters.".to_string(),
        });
    }

    Ok(())
}

fn summarize_codex_unarchive_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr_text.is_empty() {
        return stderr_text;
    }

    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout_text.is_empty() {
        return stdout_text;
    }

    "command exited without details".to_string()
}

#[cfg(test)]
mod tests {
    use super::{summarize_codex_unarchive_output, validate_codex_thread_id};

    #[test]
    fn validate_codex_thread_id_accepts_codex_uuid_shape() {
        assert!(validate_codex_thread_id("019f2019-f365-77f1-b885-2f2cd999ced9").is_ok());
    }

    #[test]
    fn validate_codex_thread_id_rejects_shell_sensitive_text() {
        assert!(validate_codex_thread_id("019f;rm -rf").is_err());
    }

    #[test]
    fn summarize_codex_unarchive_output_prefers_stderr() {
        assert_eq!(
            summarize_codex_unarchive_output(b"ok", b"not archived"),
            "not archived"
        );
    }
}
