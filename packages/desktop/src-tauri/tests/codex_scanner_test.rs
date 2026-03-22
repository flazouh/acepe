//! Integration test for Codex session scanner.
//!
//! This test requires codex-acp to be available (via npx).
//! Run with: cargo test --test codex_scanner_test -- --nocapture

use acepe_lib::codex_history::scanner;

fn live_codex_tests_enabled() -> bool {
    std::env::var("ACEPE_RUN_LIVE_CODEX_TESTS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

/// Test that scan_sessions works when Codex is available.
/// This is an integration test that actually spawns the codex-acp subprocess.
#[tokio::test]
async fn test_scan_codex_sessions() {
    if !live_codex_tests_enabled() {
        println!("Skipping Codex scanner integration test (set ACEPE_RUN_LIVE_CODEX_TESTS=1)");
        return;
    }

    // Enable logging for debugging
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_test_writer()
        .try_init();

    println!("Starting Codex session scan...");

    let result = scanner::scan_sessions(&[]).await;

    match &result {
        Ok(entries) => {
            println!("Scan succeeded! Found {} sessions", entries.len());
            for entry in entries.iter().take(5) {
                println!(
                    "  - {} (project: {}, session_id: {})",
                    entry.display, entry.project, entry.session_id
                );
            }
        }
        Err(e) => {
            println!("Scan failed: {}", e);
        }
    }

    match result {
        Ok(_) => {}
        Err(error) => {
            let message = error.to_string();
            if message.contains("No such file or directory") || message.contains("os error 2") {
                println!(
                    "Skipping Codex scanner integration test: codex-acp unavailable ({})",
                    error
                );
                return;
            }
            panic!("scan_sessions should not return an error: {}", error);
        }
    }
}
