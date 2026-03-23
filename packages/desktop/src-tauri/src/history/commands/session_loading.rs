use super::*;

#[tauri::command]
#[specta::specta]
pub async fn get_unified_session(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<Option<ConvertedSession>, String> {
    tracing::info!(
        session_id = %session_id,
        agent_id = %agent_id,
        "Loading unified session"
    );

    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    let result = match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            // Worktree sessions store their JSONL under the worktree slug, not the
            // project slug. Check the DB for a worktree_path and use it directly
            // when available, falling back to project_path for regular sessions.
            let effective_path =
                if let Some(db) = app.try_state::<DbConn>().map(|s| s.inner().clone()) {
                    SessionMetadataRepository::get_by_id(&db, &session_id)
                        .await
                        .ok()
                        .flatten()
                        .and_then(|row| row.worktree_path)
                        .unwrap_or_else(|| project_path.clone())
                } else {
                    project_path.clone()
                };

            match crate::session_jsonl::parser::parse_full_session(&session_id, &effective_path)
                .await
            {
                Ok(full_session) => {
                    let converted =
                        crate::session_converter::convert_claude_full_session_to_entries(
                            &full_session,
                        );
                    Some(converted)
                }
                // Worktree slug failed — try the project slug before giving up
                Err(_) if effective_path != project_path => {
                    match crate::session_jsonl::parser::parse_full_session(
                        &session_id,
                        &project_path,
                    )
                    .await
                    {
                        Ok(full_session) => {
                            let converted =
                                crate::session_converter::convert_claude_full_session_to_entries(
                                    &full_session,
                                );
                            Some(converted)
                        }
                        Err(e) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %e,
                                "Claude session parse failed (both worktree and project paths)"
                            );
                            None
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %e,
                        "Claude session parse failed"
                    );
                    None
                }
            }
        }
        CanonicalAgentId::Cursor => {
            // Try direct O(1) lookup first if source_path provided
            if let Some(ref sp) = source_path {
                match crate::cursor_history::parser::load_session_from_source(&session_id, sp).await
                {
                    Ok(Some(fs)) => {
                        let converted =
                            crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                        return Ok(Some(converted));
                    }
                    Ok(None) => {}
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session_id,
                            source_path = %sp,
                            error = %e,
                            "Cursor source_path load failed, falling back to find_session_by_id"
                        );
                    }
                }
            }

            // Fallback: search across all projects (existing O(n) behavior)
            match crate::cursor_history::parser::find_session_by_id(&session_id).await {
                Ok(Some(fs)) => {
                    let converted =
                        crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                    Some(converted)
                }
                Ok(None) => None,
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %e,
                        "Cursor session lookup failed"
                    );
                    None
                }
            }
        }
        CanonicalAgentId::OpenCode => {
            // Try disk-based loading first (no HTTP server needed)
            let disk_result =
                opencode_parser::load_session_from_disk(&session_id, source_path.as_deref()).await;

            if let Ok(Some(converted)) = disk_result {
                tracing::info!(
                    session_id = %session_id,
                    "Loaded OpenCode session from local disk"
                );
                Some(converted)
            } else {
                // Log why disk loading didn't work, then fall back to HTTP API
                match &disk_result {
                    Ok(None) => tracing::info!(
                        session_id = %session_id,
                        "No local messages for OpenCode session, trying HTTP API"
                    ),
                    Err(e) => tracing::warn!(
                        session_id = %session_id,
                        error = %e,
                        "Disk-based OpenCode loading failed, trying HTTP API"
                    ),
                    _ => unreachable!(),
                }
                match crate::opencode_history::commands::get_opencode_session(
                    app,
                    session_id.clone(),
                    project_path,
                )
                .await
                {
                    Ok(converted) => Some(converted),
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "HTTP fallback also failed for OpenCode session"
                        );
                        None
                    }
                }
            }
        }
        CanonicalAgentId::Codex => {
            match codex_parser::load_session(&session_id, &project_path, source_path.as_deref())
                .await
            {
                Ok(session) => session,
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %e,
                        "Codex session parse failed"
                    );
                    None
                }
            }
        }
        CanonicalAgentId::Custom(_) => {
            // Unknown custom agent - no parser available
            None
        }
    };

    // Catch-all: if any agent failed to load content, return an empty session
    // instead of None. This prevents the frontend from treating the session as
    // "not found" and auto-removing it from the session list.
    let result = result.or_else(|| Some(ConvertedSession::empty(&session_id)));

    tracing::info!(
        session_id = %session_id,
        found = result.is_some(),
        "Unified session loaded"
    );
    Ok(result)
}

/// Audit session load timing for performance bottleneck identification.
///
/// CLI-only audit (no AppHandle). Supports Claude, Cursor, Codex. Returns error for OpenCode.
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
            let full_session = session_jsonl_parser::parse_full_session_from_path(
                &session_id,
                &project_path,
                &session_path,
            )
            .await
            .map_err(|e| format!("Failed to parse Claude session: {}", e))?;
            add_stage(&mut stages, "read_and_parse", t1);

            let t2 = Instant::now();
            let converted =
                crate::session_converter::convert_claude_full_session_to_entries(&full_session);
            add_stage(&mut stages, "convert", t2);

            Some(converted)
        }
        CanonicalAgentId::Cursor => {
            if let Some(ref sp) = source_path {
                let t0 = Instant::now();
                match cursor_parser::load_session_from_source(&session_id, sp).await {
                    Ok(Some(fs)) => {
                        add_stage(&mut stages, "load_from_source", t0);
                        let t1 = Instant::now();
                        let converted =
                            crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                        add_stage(&mut stages, "convert", t1);
                        Some(converted)
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
                                let c = crate::session_converter::convert_cursor_full_session_to_entries(
                                    &fs,
                                );
                                add_stage(&mut stages, "convert", t2);
                                Some(c)
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
                        let c =
                            crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                        add_stage(&mut stages, "convert", t1);
                        Some(c)
                    }
                    None => None,
                }
            }
        }
        CanonicalAgentId::Codex => {
            let t0 = Instant::now();
            let codex_result =
                codex_parser::load_session(&session_id, &project_path, source_path.as_deref())
                    .await
                    .map_err(|e| format!("Failed to parse Codex session: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            codex_result
        }
        CanonicalAgentId::OpenCode | CanonicalAgentId::Custom(_) => {
            unreachable!("handled above")
        }
    };

    let agent_name = match canonical_agent {
        CanonicalAgentId::ClaudeCode => "claude-code",
        CanonicalAgentId::Cursor => "cursor",
        CanonicalAgentId::Codex => "codex",
        CanonicalAgentId::OpenCode | CanonicalAgentId::Custom(_) => unreachable!(),
    };

    let total_ms = total_start.elapsed().as_millis();
    let entry_count = result.as_ref().map(|c| c.entries.len()).unwrap_or(0);

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
#[tauri::command]
#[specta::specta]
pub async fn audit_session_load_timing(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionLoadTiming, String> {
    let mut stages = Vec::new();
    let total_start = Instant::now();
    let canonical_agent = CanonicalAgentId::parse(&agent_id);

    let (result, agent_name) = match canonical_agent {
        CanonicalAgentId::ClaudeCode => {
            let t0 = Instant::now();
            let session_path = session_jsonl_parser::find_session_file(&session_id, &project_path)
                .await
                .map_err(|e| format!("Failed to find Claude session file: {}", e))?;
            add_stage(&mut stages, "find_session_file", t0);

            let t1 = Instant::now();
            let full_session = session_jsonl_parser::parse_full_session_from_path(
                &session_id,
                &project_path,
                &session_path,
            )
            .await
            .map_err(|e| format!("Failed to parse Claude session: {}", e))?;
            add_stage(&mut stages, "read_and_parse", t1);

            let t2 = Instant::now();
            let converted =
                crate::session_converter::convert_claude_full_session_to_entries(&full_session);
            add_stage(&mut stages, "convert", t2);

            (Some(converted), "claude-code".to_string())
        }
        CanonicalAgentId::Cursor => {
            if let Some(ref sp) = source_path {
                let t0 = Instant::now();
                match cursor_parser::load_session_from_source(&session_id, sp).await {
                    Ok(Some(fs)) => {
                        add_stage(&mut stages, "load_from_source", t0);
                        let t1 = Instant::now();
                        let converted =
                            crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                        add_stage(&mut stages, "convert", t1);
                        (Some(converted), "cursor".to_string())
                    }
                    Ok(None) | Err(_) => {
                        add_stage(&mut stages, "load_from_source_failed", t0);
                        // Fall through to find_session_by_id
                        let t_find = Instant::now();
                        let full_session = cursor_parser::find_session_by_id(&session_id)
                            .await
                            .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                        add_stage(&mut stages, "find_transcript", t_find);
                        let converted = match full_session {
                            Some(fs) => {
                                let t2 = Instant::now();
                                let c = crate::session_converter::convert_cursor_full_session_to_entries(
                                    &fs,
                                );
                                add_stage(&mut stages, "convert", t2);
                                Some(c)
                            }
                            None => None,
                        };
                        (converted, "cursor".to_string())
                    }
                }
            } else {
                let t0 = Instant::now();
                let full_session = cursor_parser::find_session_by_id(&session_id)
                    .await
                    .map_err(|e| format!("Failed to find Cursor session: {}", e))?;
                add_stage(&mut stages, "find_transcript", t0);
                let converted = match full_session {
                    Some(fs) => {
                        let t1 = Instant::now();
                        let c =
                            crate::session_converter::convert_cursor_full_session_to_entries(&fs);
                        add_stage(&mut stages, "convert", t1);
                        Some(c)
                    }
                    None => None,
                };
                (converted, "cursor".to_string())
            }
        }
        CanonicalAgentId::OpenCode => {
            let t0 = Instant::now();
            let disk_result =
                opencode_parser::load_session_from_disk(&session_id, source_path.as_deref()).await;
            add_stage(&mut stages, "load_from_disk", t0);

            if let Ok(Some(converted)) = disk_result {
                (Some(converted), "opencode".to_string())
            } else {
                let t1 = Instant::now();
                match crate::opencode_history::commands::get_opencode_session(
                    app,
                    session_id.clone(),
                    project_path.clone(),
                )
                .await
                {
                    Ok(converted) => {
                        add_stage(&mut stages, "http_fetch", t1);
                        (Some(converted), "opencode".to_string())
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
            let codex_result =
                codex_parser::load_session(&session_id, &project_path, source_path.as_deref())
                    .await
                    .map_err(|e| format!("Failed to parse Codex session: {}", e))?;
            add_stage(&mut stages, "load_session", t0);
            (codex_result, "codex".to_string())
        }
        CanonicalAgentId::Custom(_) => {
            return Err("Custom agents do not support session load audit".to_string());
        }
    };

    let total_ms = total_start.elapsed().as_millis();
    let entry_count = result.as_ref().map(|c| c.entries.len()).unwrap_or(0);

    Ok(SessionLoadTiming {
        agent: agent_name,
        total_ms,
        stages,
        entry_count,
        ok: result.is_some(),
    })
}

/// Set the worktree path for a session in the metadata index.
/// Called by the frontend when a session is created within a worktree.
/// Validates that the path is under the worktrees root before storing.
#[tauri::command]
#[specta::specta]
pub async fn set_session_worktree_path(
    app: AppHandle,
    session_id: String,
    worktree_path: String,
    project_path: Option<String>,
    agent_id: Option<String>,
) -> Result<(), String> {
    tracing::info!(
        session_id = %session_id,
        worktree_path = %worktree_path,
        "Persisting worktree path for session"
    );

    let canonical =
        crate::git::worktree_config::validate_worktree_path(std::path::Path::new(&worktree_path))
            .map_err(|e| {
            tracing::error!(
                session_id = %session_id,
                worktree_path = %worktree_path,
                error = %e,
                "Worktree path validation failed"
            );
            format!("Invalid worktree path: {}", e)
        })?;

    let db = app
        .try_state::<DbConn>()
        .ok_or("Database not available")?
        .inner()
        .clone();

    SessionMetadataRepository::set_worktree_path(
        &db,
        &session_id,
        &canonical.to_string_lossy(),
        project_path.as_deref(),
        agent_id.as_deref(),
    )
    .await
    .map_err(|e| {
        tracing::error!(
            session_id = %session_id,
            error = %e,
            "Failed to persist worktree path to DB"
        );
        format!("Failed to set worktree path: {}", e)
    })
}

/// Persist the PR number associated with a session.
/// Called by the frontend when a PR number is discovered in session entries.
#[tauri::command]
#[specta::specta]
pub async fn set_session_pr_number(
    app: AppHandle,
    session_id: String,
    pr_number: Option<i32>,
) -> Result<(), String> {
    tracing::info!(
        session_id = %session_id,
        pr_number = ?pr_number,
        "Persisting PR number for session"
    );

    let db = app
        .try_state::<DbConn>()
        .ok_or("Database not available")?
        .inner()
        .clone();

    SessionMetadataRepository::set_pr_number(&db, &session_id, pr_number)
        .await
        .map_err(|e| {
            tracing::error!(
                session_id = %session_id,
                error = %e,
                "Failed to persist PR number to DB"
            );
            format!("Failed to set PR number: {}", e)
        })
}
