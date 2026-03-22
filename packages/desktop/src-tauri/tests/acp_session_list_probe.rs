use acepe_lib::acp::client::AcpClient;
use acepe_lib::acp::providers::codex::CodexProvider;
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

#[tokio::test]
#[ignore = "requires bundled codex-acp binary and RESOURCE_DIR to be set"]
async fn probe_codex_session_list_support() -> Result<()> {
    let provider = Arc::new(CodexProvider);
    let cwd = std::env::var("ACEPE_TEST_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|path| path.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        });
    let mut client = AcpClient::new_with_provider(provider, None, cwd)?;

    let start_total = Instant::now();
    let start_stage = Instant::now();
    if let Err(error) = client.start().await {
        let message = error.to_string();
        if message.contains("No such file or directory") || message.contains("os error 2") {
            println!(
                "Skipping probe_codex_session_list_support: Codex ACP binary unavailable ({})",
                error
            );
            return Ok(());
        }
        return Err(error.into());
    }
    let start_ms = start_stage.elapsed().as_millis();

    let init_stage = Instant::now();
    client.initialize().await?;
    let initialize_ms = init_stage.elapsed().as_millis();

    let list_stage = Instant::now();
    match client.list_sessions(None).await {
        Ok(response) => {
            let list_ms = list_stage.elapsed().as_millis();
            println!(
                "codex session/list supported count={} has_next_cursor={} start_ms={} initialize_ms={} list_ms={} total_ms={}",
                response.sessions.len(),
                response.next_cursor.is_some(),
                start_ms,
                initialize_ms,
                list_ms,
                start_total.elapsed().as_millis()
            );
        }
        Err(error) => {
            println!(
                "codex session/list error={} start_ms={} initialize_ms={} total_ms={}",
                error,
                start_ms,
                initialize_ms,
                start_total.elapsed().as_millis()
            );
        }
    }

    client.stop();
    Ok(())
}
