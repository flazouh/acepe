use super::*;

fn plan_project_path_for_context(project_path: &str, effective_project_path: &str) -> String {
    if effective_project_path.is_empty() {
        project_path.to_string()
    } else {
        effective_project_path.to_string()
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_unified_plan(
    app: AppHandle,
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
    let db = app.try_state::<DbConn>().map(|s| s.inner().clone());
    let context = crate::history::session_context::resolve_session_context(
        db.as_ref(),
        &session_id,
        &project_path,
        &agent_id,
        None,
    )
    .await;

    match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            session_jsonl_plan_loader::extract_plan_from_claude_session(
                &session_id,
                &plan_project_path_for_context(
                    &context.project_path,
                    &context.effective_project_path,
                ),
            )
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

#[cfg(test)]
mod tests {
    use super::plan_project_path_for_context;

    #[test]
    fn plan_project_path_for_context_prefers_worktree() {
        assert_eq!(
            plan_project_path_for_context("/repo", "/repo/.worktrees/feature-a"),
            "/repo/.worktrees/feature-a"
        );
    }
}
