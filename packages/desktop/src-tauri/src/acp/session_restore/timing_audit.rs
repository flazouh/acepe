use std::time::Instant;

use crate::acp::session::fold_export::MaterializedThreadSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::cursor_history::parser as cursor_parser;
use crate::opencode_history::commands::fetch_materialized_opencode_session;
use crate::session_jsonl::parser as session_jsonl_parser;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// A single timing stage for session load audit.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TimingStage {
    pub name: String,
    pub ms: u128,
}

/// Timing audit result for session load.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionLoadTiming {
    pub agent: String,
    pub total_ms: u128,
    pub stages: Vec<TimingStage>,
    pub entry_count: usize,
    pub ok: bool,
}

fn add_stage(stages: &mut Vec<TimingStage>, name: &str, start: Instant) {
    stages.push(TimingStage {
        name: name.to_string(),
        ms: start.elapsed().as_millis(),
    });
}

fn fold_first_materialized(
    agent_id: &CanonicalAgentId,
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<MaterializedThreadSnapshot>, String> {
    super::fold_audit::materialized_from_history(agent_id, session_id, project_path, source_path)
}

fn materialized_entry_count(materialized: &MaterializedThreadSnapshot) -> usize {
    materialized.transcript_snapshot.entries.len()
}

/// Audit session load timing for performance bottleneck identification.
///
/// CLI-only audit (no AppHandle). Supports Claude, Copilot, Cursor, Codex. Returns error for OpenCode.
pub async fn audit_session_load_timing_cli(
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionLoadTiming, String> {
    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    if matches!(canonical_agent, CanonicalAgentId::OpenCode) {
        return Err("OpenCode audit requires running app (use in-app invoke)".to_string());
    }
    if matches!(canonical_agent, CanonicalAgentId::Forge) {
        return Err("Forge audit is not implemented yet".to_string());
    }
    if matches!(canonical_agent, CanonicalAgentId::Custom(_)) {
        return Err("Custom agents do not support session load audit".to_string());
    }

    let mut stages = Vec::new();
    let total_start = Instant::now();

    let result = match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            let t0 = Instant::now();
            let session_path = session_jsonl_parser::find_session_file(&session_id, &project_path)
                .await
                .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
            add_stage(&mut stages, "find_session_file", t0);

            let t1 = Instant::now();
            let snapshot = super::fold_audit::claude_materialized_from_jsonl_path(
                &session_id,
                &project_path,
                session_path,
            )
            .map_err(|error| format!("Failed to fold Claude session history: {error}"))?;
            add_stage(&mut stages, "read_history_and_fold", t1);

            Some(snapshot)
        }
        CanonicalAgentId::Copilot => {
            let t0 = Instant::now();
            let snapshot = fold_first_materialized(
                &canonical_agent,
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .map_err(|e| format!("Failed to fold Copilot session history: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            snapshot
        }
        CanonicalAgentId::Cursor => {
            if let Some(ref sp) = source_path {
                let t0 = Instant::now();
                match cursor_parser::load_session_from_source(&session_id, sp).await {
                    Ok(Some(fs)) => {
                        add_stage(&mut stages, "load_from_source", t0);
                        let t1 = Instant::now();
                        let snapshot =
                            super::fold_audit::cursor_materialized_from_full_session(&fs);
                        add_stage(&mut stages, "fold", t1);
                        Some(snapshot)
                    }
                    Ok(None) | Err(_) => {
                        add_stage(&mut stages, "load_from_source_failed", t0);
                        let t_find = Instant::now();
                        let full_session = cursor_parser::find_session_by_id(&session_id)
                            .await
                            .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                        add_stage(&mut stages, "find_transcript", t_find);
                        match full_session {
                            Some(fs) => {
                                let t2 = Instant::now();
                                let s =
                                    super::fold_audit::cursor_materialized_from_full_session(&fs);
                                add_stage(&mut stages, "fold", t2);
                                Some(s)
                            }
                            None => None,
                        }
                    }
                }
            } else {
                let t0 = Instant::now();
                let full_session = cursor_parser::find_session_by_id(&session_id)
                    .await
                    .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                add_stage(&mut stages, "find_transcript", t0);
                match full_session {
                    Some(fs) => {
                        let t1 = Instant::now();
                        let s = super::fold_audit::cursor_materialized_from_full_session(&fs);
                        add_stage(&mut stages, "fold", t1);
                        Some(s)
                    }
                    None => None,
                }
            }
        }
        CanonicalAgentId::Codex => {
            let t0 = Instant::now();
            let snapshot = fold_first_materialized(
                &canonical_agent,
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .map_err(|e| format!("Failed to fold Codex session history: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            snapshot
        }
        CanonicalAgentId::OpenCode | CanonicalAgentId::Forge | CanonicalAgentId::Custom(_) => {
            unreachable!("handled above")
        }
    };

    let agent_name = match canonical_agent {
        CanonicalAgentId::ClaudeCode => "claude-code",
        CanonicalAgentId::Copilot => "copilot",
        CanonicalAgentId::Cursor => "cursor",
        CanonicalAgentId::Codex => "codex",
        CanonicalAgentId::OpenCode | CanonicalAgentId::Forge | CanonicalAgentId::Custom(_) => {
            unreachable!()
        }
    };

    let total_ms = total_start.elapsed().as_millis();
    let entry_count = result.as_ref().map(materialized_entry_count).unwrap_or(0);

    Ok(SessionLoadTiming {
        agent: agent_name.to_string(),
        total_ms,
        stages,
        entry_count,
        ok: result.is_some(),
    })
}

/// Returns per-stage durations (ms) for file discovery, parse, convert, etc.
/// Supports Claude and Cursor in CLI mode; OpenCode requires running app.
pub async fn audit_session_load_timing_with_app(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionLoadTiming, String> {
    let mut stages = Vec::new();
    let total_start = Instant::now();
    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    if matches!(canonical_agent, CanonicalAgentId::Forge) {
        return Err("Forge audit is not implemented yet".to_string());
    }

    let (result, agent_name) = match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            let t0 = Instant::now();
            let session_path = session_jsonl_parser::find_session_file(&session_id, &project_path)
                .await
                .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
            add_stage(&mut stages, "find_session_file", t0);

            let t1 = Instant::now();
            let snapshot = super::fold_audit::claude_materialized_from_jsonl_path(
                &session_id,
                &project_path,
                session_path,
            )
            .map_err(|error| format!("Failed to fold Claude session history: {error}"))?;
            add_stage(&mut stages, "read_history_and_fold", t1);

            (Some(snapshot), "claude-code".to_string())
        }
        CanonicalAgentId::Copilot => {
            let t0 = Instant::now();
            let snapshot = fold_first_materialized(
                &canonical_agent,
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .map_err(|e| format!("Failed to fold Copilot session history: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            (snapshot, "copilot".to_string())
        }
        CanonicalAgentId::Cursor => {
            if let Some(ref sp) = source_path {
                let t0 = Instant::now();
                match cursor_parser::load_session_from_source(&session_id, sp).await {
                    Ok(Some(fs)) => {
                        add_stage(&mut stages, "load_from_source", t0);
                        let t1 = Instant::now();
                        let snapshot =
                            super::fold_audit::cursor_materialized_from_full_session(&fs);
                        add_stage(&mut stages, "fold", t1);
                        (Some(snapshot), "cursor".to_string())
                    }
                    Ok(None) | Err(_) => {
                        add_stage(&mut stages, "load_from_source_failed", t0);
                        let t_find = Instant::now();
                        let full_session = cursor_parser::find_session_by_id(&session_id)
                            .await
                            .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                        add_stage(&mut stages, "find_transcript", t_find);
                        let snapshot = match full_session {
                            Some(fs) => {
                                let t2 = Instant::now();
                                let s =
                                    super::fold_audit::cursor_materialized_from_full_session(&fs);
                                add_stage(&mut stages, "fold", t2);
                                Some(s)
                            }
                            None => None,
                        };
                        (snapshot, "cursor".to_string())
                    }
                }
            } else {
                let t0 = Instant::now();
                let full_session = cursor_parser::find_session_by_id(&session_id)
                    .await
                    .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                add_stage(&mut stages, "find_transcript", t0);
                let snapshot = match full_session {
                    Some(fs) => {
                        let t1 = Instant::now();
                        let s = super::fold_audit::cursor_materialized_from_full_session(&fs);
                        add_stage(&mut stages, "fold", t1);
                        Some(s)
                    }
                    None => None,
                };
                (snapshot, "cursor".to_string())
            }
        }
        CanonicalAgentId::OpenCode => {
            let t0 = Instant::now();
            let snapshot = fold_first_materialized(
                &canonical_agent,
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .map_err(|e| format!("Failed to fold OpenCode session history: {}", e))?;
            add_stage(&mut stages, "load_from_disk", t0);

            if let Some(snapshot) = snapshot {
                (Some(snapshot), "opencode".to_string())
            } else {
                let t1 = Instant::now();
                match fetch_materialized_opencode_session(&app, &session_id, &project_path).await {
                    Ok(materialized) => {
                        add_stage(&mut stages, "http_fetch", t1);
                        (Some(materialized), "opencode".to_string())
                    }
                    Err(e) => {
                        add_stage(&mut stages, "http_failed", t1);
                        return Err(e);
                    }
                }
            }
        }
        CanonicalAgentId::Codex => {
            let t0 = Instant::now();
            let snapshot = fold_first_materialized(
                &canonical_agent,
                &session_id,
                &project_path,
                source_path.as_deref(),
            )
            .map_err(|e| format!("Failed to fold Codex session history: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            (snapshot, "codex".to_string())
        }
        CanonicalAgentId::Custom(_) => {
            return Err("Custom agents do not support session load audit".to_string());
        }
        CanonicalAgentId::Forge => unreachable!("handled above"),
    };

    let total_ms = total_start.elapsed().as_millis();
    let entry_count = result.as_ref().map(materialized_entry_count).unwrap_or(0);

    Ok(SessionLoadTiming {
        agent: agent_name,
        total_ms,
        stages,
        entry_count,
        ok: result.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::audit_session_load_timing_cli;

    #[tokio::test]
    #[ignore = "manual real-provider timing audit"]
    async fn manual_real_provider_timing_audit() {
        let session_id =
            std::env::var("ACEPE_AUDIT_SESSION_ID").expect("ACEPE_AUDIT_SESSION_ID is required");
        let project_path = std::env::var("ACEPE_AUDIT_PROJECT_PATH")
            .expect("ACEPE_AUDIT_PROJECT_PATH is required");
        let agent_id =
            std::env::var("ACEPE_AUDIT_AGENT_ID").expect("ACEPE_AUDIT_AGENT_ID is required");
        let source_path = std::env::var("ACEPE_AUDIT_SOURCE_PATH").ok();

        let timing = audit_session_load_timing_cli(session_id, project_path, agent_id, source_path)
            .await
            .expect("real-provider timing audit should run");

        assert!(
            timing.ok,
            "expected timing audit to find a restorable session"
        );
        assert!(
            timing.entry_count > 0,
            "expected timing audit to restore a non-empty session"
        );
        println!(
            "{}",
            serde_json::to_string(&timing).expect("serialize timing audit")
        );
    }
}
