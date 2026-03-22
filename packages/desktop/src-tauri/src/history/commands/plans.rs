use super::*;

#[tauri::command]
#[specta::specta]
pub async fn get_unified_plan(
    session_id: String,
    project_path: String,
    agent_id: String,
) -> Result<Option<SessionPlanResponse>, String> {
    let logger_id = format!("unified_plan_{}", &session_id[..8.min(session_id.len())]);
    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        project_path = %project_path,
        agent_id = %agent_id,
        "Getting unified plan"
    );

    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            session_jsonl_plan_loader::extract_plan_from_claude_session(&session_id, &project_path)
                .await
        }
        CanonicalAgentId::Cursor => {
            cursor_plan_loader::extract_plan_from_cursor_session(&session_id, &project_path).await
        }
        CanonicalAgentId::OpenCode => {
            tracing::debug!(
                logger_id = %logger_id,
                agent_id = %agent_id,
                "OpenCode plan extraction disabled, returning None"
            );
            Ok(None)
        }
        CanonicalAgentId::Codex => Ok(None),
        // Graceful fallback for agents without plans
        CanonicalAgentId::Custom(_) => {
            tracing::debug!(
                logger_id = %logger_id,
                agent_id = %agent_id,
                "Agent does not support plans, returning None"
            );
            Ok(None)
        }
    }
}
