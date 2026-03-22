//! Debug why a Cursor session gets a given title (or "Chat XXXXXX" fallback).
//!
//! Usage:
//!   cargo run --bin debug_cursor_session_title [SESSION_ID]
//!
//! Default SESSION_ID: 7377ad20-98c4-47bb-9540-f44156420c63

use acepe_lib::cursor_history::parser::{
    diagnose_cursor_session_title_from_path, get_sqlite_store_db_path_for_session,
};
use std::path::Path;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let session_id = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "7377ad20-98c4-47bb-9540-f44156420c63".to_string());

    println!("Session ID: {}", session_id);
    println!();

    let path = get_sqlite_store_db_path_for_session(&session_id).await?;
    let path = match path {
        Some(p) => p,
        None => {
            eprintln!("No store.db found for this session under ~/.cursor/chats");
            eprintln!("(Session may be from transcripts only, or Cursor chats dir not present.)");
            std::process::exit(1);
        }
    };

    println!("Store path: {}", path.display());
    println!();

    let report = diagnose_cursor_session_title_from_path(Path::new(&path)).await?;
    print!("{}", report);

    Ok(())
}
