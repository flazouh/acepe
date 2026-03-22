use anyhow::{Context, Result};
use futures::StreamExt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncBufReadExt;
use tokio_util::io::StreamReader;
use tokio_util::sync::CancellationToken;

use crate::acp::ui_event_dispatcher::AcpUiEventDispatcher;

use super::conversion::{
    SSE_MAX_CONSECUTIVE_READ_ERRORS, SSE_RECONNECT_BASE_DELAY_MS, SSE_RECONNECT_JITTER_MS,
    SSE_RECONNECT_MAX_DELAY_MS,
};
use super::routing::handle_sse_event;

pub(super) async fn connect_and_process_stream(
    url: &str,
    dispatcher: &AcpUiEventDispatcher,
    cancel_token: &CancellationToken,
) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(24 * 60 * 60)) // 24 hours for long-lived SSE
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .build()
        .context("Failed to build HTTP client for SSE")?;

    let response = client
        .get(url)
        .header("accept", "text/event-stream")
        .header("accept-encoding", "identity")
        .send()
        .await
        .context("Failed to connect to SSE endpoint")?;

    if !response.status().is_success() {
        anyhow::bail!("SSE connect failed with status {}", response.status());
    }

    tracing::info!("Connected to OpenCode SSE stream");

    let stream = response
        .bytes_stream()
        .map(|result| result.map_err(std::io::Error::other));

    let mut reader = StreamReader::new(stream);
    let mut buf = Vec::new();
    let mut data_lines: Vec<String> = Vec::new();
    let mut consecutive_errors: u32 = 0;

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                tracing::info!("SSE stream cancelled");
                return Ok(());
            }

            result = reader.read_until(b'\n', &mut buf) => {
                match result {
                    Ok(0) => {
                        anyhow::bail!("SSE stream ended");
                    }
                    Ok(_) => {
                        consecutive_errors = 0;
                        let line = match std::str::from_utf8(&buf) {
                            Ok(s) => s.trim_end(),
                            Err(error) => {
                                tracing::warn!(%error, "Invalid UTF-8 in SSE stream");
                                buf.clear();
                                continue;
                            }
                        };

                        if line.is_empty() {
                            if !data_lines.is_empty() {
                                let raw = data_lines.join("\n");
                                data_lines.clear();
                                if let Err(error) = handle_sse_event(&raw, dispatcher) {
                                    tracing::warn!(%error, "Failed to handle SSE event");
                                }
                            }
                            buf.clear();
                            continue;
                        }

                        if let Some(rest) = line.strip_prefix("data:") {
                            data_lines.push(rest.trim_start().to_string());
                        } else if line.starts_with("event:") || line.starts_with("id:") || line.starts_with("retry:") {
                            // Ignore non-data fields
                        }

                        buf.clear();
                    }
                    Err(error) => {
                        consecutive_errors += 1;
                        tracing::error!(
                            %error,
                            consecutive_errors,
                            max_errors = SSE_MAX_CONSECUTIVE_READ_ERRORS,
                            "Error reading SSE stream"
                        );

                        if consecutive_errors >= SSE_MAX_CONSECUTIVE_READ_ERRORS {
                            anyhow::bail!("Too many consecutive SSE read errors");
                        }

                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        }
    }
}

pub(super) fn reconnect_delay(reconnect_attempt: u32) -> Duration {
    let exponent = reconnect_attempt.min(6);
    let multiplier = 1u64 << exponent;
    let base_delay_ms = SSE_RECONNECT_BASE_DELAY_MS.saturating_mul(multiplier);
    let jitter_seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_millis() as u64)
        .unwrap_or(0);
    let jitter_ms = jitter_seed % SSE_RECONNECT_JITTER_MS;
    let delay_ms = (base_delay_ms + jitter_ms).min(SSE_RECONNECT_MAX_DELAY_MS);
    Duration::from_millis(delay_ms)
}
