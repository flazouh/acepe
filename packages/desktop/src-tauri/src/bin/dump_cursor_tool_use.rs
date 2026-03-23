//! Dump raw Cursor store.db tool_use / tool-call blocks so we can confirm
//! exactly what fields Cursor stores (e.g. whether "kind" exists).
//!
//! Usage:
//!   cargo run --bin dump_cursor_tool_use -- <path-to-store.db>
//!
//! Example:
//!   cargo run --bin dump_cursor_tool_use -- ~/.cursor/chats/<project-hash>/<agent-id>/store.db

use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args()
        .nth(1)
        .ok_or("Usage: dump_cursor_tool_use <path-to-store.db>")?;
    let db_path = Path::new(&db_path);

    if !db_path.exists() {
        eprintln!("File not found: {}", db_path.display());
        std::process::exit(1);
    }

    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let mut stmt = conn.prepare("SELECT data FROM blobs ORDER BY rowid")?;
    let rows = stmt.query_map([], |row| row.get::<_, Vec<u8>>(0))?;

    let mut count = 0usize;
    for row in rows {
        let data = row?;
        if let Some(json_str) = extract_json_object_from_blob(&data) {
            let value: serde_json::Value = match serde_json::from_str(&json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let content = match value.get("content") {
                Some(c) => c,
                None => continue,
            };
            let arr = match content.as_array() {
                Some(a) => a,
                None => continue,
            };
            for item in arr {
                let ty = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ty != "tool_use" && ty != "tool-use" && ty != "tool-call" {
                    continue;
                }
                count += 1;
                println!("--- raw tool block #{} (type={}) ---", count, ty);
                println!("{}", serde_json::to_string_pretty(item)?);
                println!();
                if count >= 20 {
                    println!("(stopped after 20 blocks)");
                    return Ok(());
                }
            }
        }
    }

    if count == 0 {
        println!("No tool_use / tool-call blocks found in blobs.");
    }
    Ok(())
}

fn extract_json_object_from_blob(data: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(data);
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }
    Some(text[start..=end].to_string())
}
