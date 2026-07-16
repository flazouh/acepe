//! OpenCode sqlite storage reader.
//!
//! Modern opencode installs store sessions/messages/parts in
//! `~/.local/share/opencode/opencode.db` instead of the legacy JSON
//! `storage/{project,session,message,part}` layout. This module reads that
//! database READ-ONLY and produces the same output types the JSON path
//! produces, so everything downstream (convert.rs, ingress source, provider
//! counts, history entries) works unchanged.

use anyhow::{anyhow, Result};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::types::{OpenCodeApiPart, OpenCodeMessage};
use crate::session_jsonl::types::HistoryEntry;

/// Which opencode storage layout is present on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenCodeStorageLayout {
    /// Legacy JSON files under `storage/{project,session,message,part}`.
    LegacyJson { storage_dir: PathBuf },
    /// Modern sqlite database `opencode.db`.
    Sqlite { db_path: PathBuf },
    /// Neither layout found.
    None,
}

/// Resolve the storage layout inside an opencode data dir
/// (e.g. `~/.local/share/opencode`).
///
/// Prefers the legacy JSON scanner when `storage/session` exists, else the
/// sqlite reader when `opencode.db` exists.
pub fn resolve_storage_layout(data_dir: &Path) -> OpenCodeStorageLayout {
    let legacy_sessions = data_dir.join("storage").join("session");
    if legacy_sessions.is_dir() {
        return OpenCodeStorageLayout::LegacyJson {
            storage_dir: data_dir.join("storage"),
        };
    }

    let db_path = data_dir.join("opencode.db");
    if db_path.is_file() {
        return OpenCodeStorageLayout::Sqlite { db_path };
    }

    OpenCodeStorageLayout::None
}

/// Resolve the layout for the real opencode data dir on this machine.
///
/// OpenCode uses XDG paths (`~/.local/share/opencode`) even on macOS, so we
/// check that first before the platform default — same policy as
/// `parser::get_storage_dir`.
pub fn resolve_default_storage_layout() -> OpenCodeStorageLayout {
    if let Some(home) = dirs::home_dir() {
        let xdg_dir = home.join(".local/share/opencode");
        let layout = resolve_storage_layout(&xdg_dir);
        if layout != OpenCodeStorageLayout::None {
            return layout;
        }
    }

    match dirs::data_local_dir() {
        Some(dir) => resolve_storage_layout(&dir.join("opencode")),
        None => OpenCodeStorageLayout::None,
    }
}

/// Open the opencode sqlite database read-only.
///
/// The live opencode process may hold this db (WAL mode); read-only open with
/// a busy timeout must not lock or corrupt it.
fn open_read_only(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        anyhow!(
            "Failed to open opencode.db read-only at {}: {e}",
            db_path.display()
        )
    })?;
    conn.busy_timeout(std::time::Duration::from_secs(2))?;
    Ok(conn)
}

/// Scan all projects: map of project id → worktree path.
pub fn scan_projects_sqlite(db_path: &Path) -> Result<HashMap<String, String>> {
    let conn = open_read_only(db_path)?;
    let mut stmt = conn.prepare("SELECT id, worktree FROM project")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut project_map = HashMap::new();
    for row in rows {
        let (id, worktree) = row?;
        project_map.insert(id, worktree);
    }
    Ok(project_map)
}

/// Scan sessions, filtered by project worktree paths (empty = discovery mode).
/// Mirrors `parser::scan_sessions` semantics: skips the "global" project and
/// child/subagent sessions keep their `parent_id` populated.
pub fn scan_sessions_sqlite(db_path: &Path, project_paths: &[String]) -> Result<Vec<HistoryEntry>> {
    use crate::acp::types::CanonicalAgentId;
    use crate::history::constants::MAX_SESSIONS_PER_PROJECT;

    let conn = open_read_only(db_path)?;
    let discovery_mode = project_paths.is_empty();

    let mut stmt = conn.prepare(
        "SELECT s.id, s.parent_id, s.title, s.directory, s.time_created, s.time_updated, \
                s.project_id, p.worktree \
         FROM session s \
         LEFT JOIN project p ON p.id = s.project_id \
         WHERE s.project_id != 'global' \
         ORDER BY s.time_updated DESC",
    )?;

    struct SessionRow {
        id: String,
        parent_id: Option<String>,
        title: String,
        directory: String,
        time_created: i64,
        time_updated: i64,
        project_id: String,
        worktree: Option<String>,
    }

    let rows = stmt.query_map([], |row| {
        Ok(SessionRow {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            title: row.get(2)?,
            directory: row.get(3)?,
            time_created: row.get(4)?,
            time_updated: row.get(5)?,
            project_id: row.get(6)?,
            worktree: row.get(7)?,
        })
    })?;

    let mut entries = Vec::new();
    let mut sessions_per_project: HashMap<String, usize> = HashMap::new();

    for row in rows {
        let row = row?;

        let project_path = row
            .worktree
            .clone()
            .unwrap_or_else(|| format!("unknown:{}", row.project_id));

        // Filter by project path when not in discovery mode.
        // Match on either the project worktree or the session's own directory
        // (worktree sessions record their directory separately).
        if !discovery_mode
            && !project_paths
                .iter()
                .any(|p| *p == project_path || *p == row.directory)
        {
            continue;
        }

        let per_project = sessions_per_project
            .entry(row.project_id.clone())
            .or_insert(0);
        if *per_project >= MAX_SESSIONS_PER_PROJECT {
            continue;
        }
        *per_project += 1;

        let display = if row.title.trim().is_empty() {
            let id_preview = row.id.chars().take(8).collect::<String>();
            format!("Session {}", id_preview)
        } else {
            row.title.clone()
        };

        entries.push(HistoryEntry {
            id: uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, row.id.as_bytes()).to_string(),
            display,
            timestamp: row.time_created,
            project: project_path,
            session_id: row.id,
            pasted_contents: serde_json::json!({}),
            agent_id: CanonicalAgentId::OpenCode,
            updated_at: row.time_updated.max(row.time_created),
            source_path: None,
            parent_id: row.parent_id,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            worktree_deleted: None,
            session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
            sequence_id: None,
            usage_stats: None,
        });
    }

    Ok(entries)
}

/// Load ordered messages + parts for one session.
/// Returns `Ok(None)` when the session has no messages (mirrors the JSON
/// path's NotFound → fall through to HTTP).
pub fn load_messages_sqlite(
    db_path: &Path,
    session_id: &str,
) -> Result<Option<Vec<OpenCodeMessage>>> {
    let conn = open_read_only(db_path)?;
    let mut message_stmt = conn.prepare(
        "SELECT id, time_created, data
         FROM message
         WHERE session_id = ?1
         ORDER BY time_created ASC, id ASC",
    )?;
    let message_rows = message_stmt.query_map([session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut messages = Vec::new();
    for row in message_rows {
        let (id, time_created, data) = row?;
        let data: serde_json::Value = serde_json::from_str(&data)
            .map_err(|error| anyhow!("Invalid OpenCode message {id} JSON: {error}"))?;
        let role = data
            .get("role")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| anyhow!("OpenCode message {id} has no role"))?
            .to_string();
        let model = data
            .get("model")
            .and_then(|model| {
                Some(format!(
                    "{}/{}",
                    model.get("providerID")?.as_str()?,
                    model.get("modelID")?.as_str()?
                ))
            })
            .or_else(|| {
                Some(format!(
                    "{}/{}",
                    data.get("providerID")?.as_str()?,
                    data.get("modelID")?.as_str()?
                ))
            });
        let timestamp = data
            .get("time")
            .and_then(|time| time.get("created"))
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(time_created)
            .to_string();

        messages.push((id, role, model, timestamp));
    }

    if messages.is_empty() {
        return Ok(None);
    }

    let mut part_stmt = conn.prepare(
        "SELECT id, message_id, session_id, time_created, data
         FROM part
         WHERE session_id = ?1
         ORDER BY message_id ASC, time_created ASC, id ASC",
    )?;
    let part_rows = part_stmt.query_map([session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut parts_by_message: HashMap<String, Vec<super::types::OpenCodeMessagePart>> =
        HashMap::new();

    for row in part_rows {
        let (id, message_id, row_session_id, time_created, data) = row?;
        let mut data: serde_json::Value = serde_json::from_str(&data)
            .map_err(|error| anyhow!("Invalid OpenCode part {id} JSON: {error}"))?;
        let object = data
            .as_object_mut()
            .ok_or_else(|| anyhow!("OpenCode part {id} JSON is not an object"))?;
        object.insert("id".to_string(), serde_json::json!(id));
        object.insert("messageID".to_string(), serde_json::json!(message_id));
        object.insert("sessionID".to_string(), serde_json::json!(row_session_id));
        object
            .entry("time".to_string())
            .or_insert_with(|| serde_json::json!({ "start": time_created }));

        let part: OpenCodeApiPart = serde_json::from_value(data)
            .map_err(|error| anyhow!("Invalid OpenCode part {id} row: {error}"))?;
        parts_by_message
            .entry(message_id)
            .or_default()
            .push(crate::opencode_history::parser::convert_api_part(part));
    }

    Ok(Some(
        messages
            .into_iter()
            .map(|(id, role, model, timestamp)| OpenCodeMessage {
                parts: parts_by_message.remove(&id).unwrap_or_default(),
                id,
                role,
                model,
                timestamp: Some(timestamp),
            })
            .collect(),
    ))
}

/// Count sessions for a project worktree path.
pub fn count_sessions_sqlite(db_path: &Path, project_path: &str) -> Result<u32> {
    let conn = open_read_only(db_path)?;
    let count = conn.query_row(
        "SELECT COUNT(*)
         FROM session s
         INNER JOIN project p ON p.id = s.project_id
         WHERE p.worktree = ?1 AND s.project_id != 'global'",
        [project_path],
        |row| row.get::<_, u32>(0),
    )?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opencode_history::types::OpenCodeMessagePart;
    use tempfile::tempdir;

    /// Build a temp opencode.db mirroring the real schema (verified via
    /// `.schema` on a live install) with one 'Greeting' session and a
    /// user/assistant exchange.
    fn build_fixture_db(dir: &Path) -> PathBuf {
        let db_path = dir.join("opencode.db");
        let conn = Connection::open(&db_path).expect("create fixture db");
        conn.execute_batch(
            r#"
            CREATE TABLE project (
                id TEXT PRIMARY KEY,
                worktree TEXT NOT NULL,
                vcs TEXT,
                name TEXT,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL
            );
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                parent_id TEXT,
                slug TEXT NOT NULL,
                directory TEXT NOT NULL,
                title TEXT NOT NULL,
                version TEXT NOT NULL,
                share_url TEXT,
                revert TEXT,
                permission TEXT,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                time_compacting INTEGER,
                time_archived INTEGER
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            "#,
        )
        .expect("create schema");

        conn.execute(
            "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated)
             VALUES ('proj-hash-1', '/Users/test/project', 'git', 'project', 1000, 2000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project (id, worktree, vcs, name, time_created, time_updated)
             VALUES ('global', '/', NULL, NULL, 1000, 2000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
             VALUES ('ses_greeting', 'proj-hash-1', NULL, 'greeting', '/Users/test/project', 'Greeting', '1.0.0', 1000, 5000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
             VALUES ('ses_child', 'proj-hash-1', 'ses_greeting', 'child', '/Users/test/project', 'Child task (@explore subagent)', '1.0.0', 1500, 1600)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
             VALUES ('ses_other', 'other-proj', NULL, 'other', '/Users/test/other', 'Other project session', '1.0.0', 1200, 1300)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
             VALUES ('ses_global', 'global', NULL, 'global-s', '/', 'Global session', '1.0.0', 1100, 1200)",
            [],
        )
        .unwrap();

        // Messages: data JSON matches the real db format (role/time/model
        // nested objects, verified against a live opencode.db).
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (
                'msg_user_1', 'ses_greeting', 1000, 1000,
                '{\"role\":\"user\",\"time\":{\"created\":1000},\"agent\":\"build\",\"model\":{\"providerID\":\"openrouter\",\"modelID\":\"anthropic/claude-sonnet-5\"},\"summary\":{\"diffs\":[]}}'
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (
                'msg_asst_1', 'ses_greeting', 2000, 2500,
                '{\"parentID\":\"msg_user_1\",\"role\":\"assistant\",\"mode\":\"build\",\"agent\":\"build\",\"modelID\":\"anthropic/claude-sonnet-5\",\"providerID\":\"openrouter\",\"time\":{\"created\":2000,\"completed\":2500},\"finish\":\"stop\"}'
            )",
            [],
        )
        .unwrap();

        // Parts: data JSON matches real part rows (type/text/time, step markers).
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (
                'prt_u1', 'msg_user_1', 'ses_greeting', 1000, 1000,
                '{\"type\":\"text\",\"text\":\"hi\"}'
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (
                'prt_a0', 'msg_asst_1', 'ses_greeting', 2000, 2000,
                '{\"snapshot\":\"394fab78\",\"type\":\"step-start\"}'
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (
                'prt_a1', 'msg_asst_1', 'ses_greeting', 2100, 2100,
                '{\"type\":\"text\",\"text\":\"Hello! How can I help?\",\"time\":{\"start\":2100,\"end\":2100}}'
            )",
            [],
        )
        .unwrap();

        db_path
    }

    // --- layout resolution ---

    #[test]
    fn resolve_layout_prefers_legacy_json_when_storage_session_exists() {
        let temp = tempdir().expect("temp dir");
        std::fs::create_dir_all(temp.path().join("storage/session")).unwrap();
        // Even if the db also exists, legacy wins.
        build_fixture_db(temp.path());

        let layout = resolve_storage_layout(temp.path());
        assert_eq!(
            layout,
            OpenCodeStorageLayout::LegacyJson {
                storage_dir: temp.path().join("storage")
            }
        );
    }

    #[test]
    fn resolve_layout_uses_sqlite_when_only_db_exists() {
        let temp = tempdir().expect("temp dir");
        build_fixture_db(temp.path());

        let layout = resolve_storage_layout(temp.path());
        assert_eq!(
            layout,
            OpenCodeStorageLayout::Sqlite {
                db_path: temp.path().join("opencode.db")
            }
        );
    }

    #[test]
    fn resolve_layout_none_when_nothing_exists() {
        let temp = tempdir().expect("temp dir");
        assert_eq!(
            resolve_storage_layout(temp.path()),
            OpenCodeStorageLayout::None
        );
    }

    // --- projects ---

    #[test]
    fn scan_projects_sqlite_maps_id_to_worktree() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let projects = scan_projects_sqlite(&db_path).expect("scan projects");
        assert_eq!(
            projects.get("proj-hash-1").map(String::as_str),
            Some("/Users/test/project")
        );
        assert!(projects.contains_key("global"));
    }

    // --- sessions ---

    #[test]
    fn scan_sessions_sqlite_returns_real_title_for_matching_project() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let entries =
            scan_sessions_sqlite(&db_path, &["/Users/test/project".to_string()]).expect("scan");

        let greeting = entries
            .iter()
            .find(|e| e.session_id == "ses_greeting")
            .expect("greeting session present");
        assert_eq!(greeting.display, "Greeting");
        assert_eq!(greeting.project, "/Users/test/project");
        assert_eq!(greeting.timestamp, 1000);
        assert!(greeting.updated_at >= 5000);
        assert_eq!(greeting.parent_id, None);

        // Child/subagent sessions are included with parent_id set,
        // mirroring the JSON path.
        let child = entries
            .iter()
            .find(|e| e.session_id == "ses_child")
            .expect("child session present");
        assert_eq!(child.parent_id.as_deref(), Some("ses_greeting"));

        // Other project's session filtered out.
        assert!(entries.iter().all(|e| e.session_id != "ses_other"));
        // Global sessions always skipped, mirroring the JSON path.
        assert!(entries.iter().all(|e| e.session_id != "ses_global"));
    }

    #[test]
    fn scan_sessions_sqlite_discovery_mode_includes_all_non_global() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let entries = scan_sessions_sqlite(&db_path, &[]).expect("scan");

        let ids: Vec<&str> = entries.iter().map(|e| e.session_id.as_str()).collect();
        assert!(ids.contains(&"ses_greeting"));
        assert!(ids.contains(&"ses_other"));
        assert!(!ids.contains(&"ses_global"));
    }

    #[test]
    fn scan_sessions_sqlite_entry_id_matches_json_path_uuid_derivation() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let entries =
            scan_sessions_sqlite(&db_path, &["/Users/test/project".to_string()]).expect("scan");
        let greeting = entries
            .iter()
            .find(|e| e.session_id == "ses_greeting")
            .expect("greeting");
        let expected = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, b"ses_greeting").to_string();
        assert_eq!(greeting.id, expected);
        assert_eq!(
            greeting.agent_id,
            crate::acp::types::CanonicalAgentId::OpenCode
        );
    }

    // --- messages ---

    #[test]
    fn load_messages_sqlite_returns_ordered_messages_with_parts() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let messages = load_messages_sqlite(&db_path, "ses_greeting")
            .expect("load")
            .expect("messages present");

        assert_eq!(messages.len(), 2);

        let user = &messages[0];
        assert_eq!(user.id, "msg_user_1");
        assert_eq!(user.role, "user");
        assert_eq!(user.timestamp.as_deref(), Some("1000"));
        assert_eq!(
            user.model.as_deref(),
            Some("openrouter/anthropic/claude-sonnet-5")
        );
        assert_eq!(user.parts.len(), 1);
        match &user.parts[0] {
            OpenCodeMessagePart::Text { text } => assert_eq!(text, "hi"),
            other => panic!("expected text part, got {other:?}"),
        }

        let assistant = &messages[1];
        assert_eq!(assistant.id, "msg_asst_1");
        assert_eq!(assistant.role, "assistant");
        assert_eq!(
            assistant.model.as_deref(),
            Some("openrouter/anthropic/claude-sonnet-5")
        );
        // step-start converts to empty text (same as JSON path convert_api_part),
        // followed by the real text part.
        assert_eq!(assistant.parts.len(), 2);
        match &assistant.parts[1] {
            OpenCodeMessagePart::Text { text } => assert_eq!(text, "Hello! How can I help?"),
            other => panic!("expected text part, got {other:?}"),
        }
    }

    #[test]
    fn load_messages_sqlite_returns_none_for_unknown_session() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let result = load_messages_sqlite(&db_path, "ses_missing").expect("load");
        assert!(result.is_none());
    }

    #[test]
    fn sqlite_history_loads_ordered_messages_and_provider_events() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        let messages = load_messages_sqlite(&db_path, "ses_greeting")
            .expect("load")
            .expect("messages present");
        let events =
            crate::opencode_history::convert::opencode_messages_to_provider_events(&messages);

        assert_eq!(
            messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["msg_user_1", "msg_asst_1"]
        );
        assert!(!events.is_empty());
    }

    #[test]
    #[ignore = "requires the local OpenCode SQLite database"]
    fn real_f38_sqlite_history_loads_provider_events() {
        let db_path = match resolve_default_storage_layout() {
            OpenCodeStorageLayout::Sqlite { db_path } => db_path,
            layout => panic!("expected modern OpenCode SQLite storage, got {layout:?}"),
        };
        let messages = load_messages_sqlite(&db_path, "ses_0a3e2f368ffeLHjFLEnP4IL70v")
            .expect("load F38")
            .expect("F38 messages present");
        let events =
            crate::opencode_history::convert::opencode_messages_to_provider_events(&messages);

        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
        assert!(!events.is_empty());
    }

    // --- counts ---

    #[test]
    fn count_sessions_sqlite_counts_project_sessions() {
        let temp = tempdir().expect("temp dir");
        let db_path = build_fixture_db(temp.path());

        // greeting + child both belong to /Users/test/project
        let count = count_sessions_sqlite(&db_path, "/Users/test/project").expect("count");
        assert_eq!(count, 2);

        let none = count_sessions_sqlite(&db_path, "/nonexistent").expect("count");
        assert_eq!(none, 0);
    }
}
