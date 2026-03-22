use anyhow::Result;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::acp::ui_event_dispatcher::{AcpUiEventDispatcher, DispatchPolicy};

mod conversion;
mod routing;
mod stream;

use stream::{connect_and_process_stream, reconnect_delay};

#[cfg(test)]
use conversion::{
    cache_message_role_from_update, convert_message_part_to_session_update,
    convert_permission_asked_to_session_update, convert_question_asked_to_session_update,
    convert_session_error_to_session_update, convert_session_idle_to_session_update,
    convert_session_status_to_session_update, EventEnvelope, MultiplexedEventEnvelope,
};

pub fn clear_message_role_cache() {
    conversion::clear_message_role_cache();
}

pub fn clear_message_part_text_cache() {
    conversion::clear_message_part_text_cache();
}

pub fn clear_all_message_roles() {
    conversion::clear_all_message_roles();
}

/// Subscribe to OpenCode SSE events and emit them as Tauri events.
pub async fn subscribe_to_events(
    base_url: &str,
    directory: Option<&str>,
    app_handle: AppHandle,
    cancel_token: CancellationToken,
) -> Result<tokio::task::JoinHandle<()>> {
    let url = if let Some(dir) = directory {
        format!("{}/event?directory={}", base_url, urlencoding::encode(dir))
    } else {
        format!("{}/global/event", base_url)
    };

    tracing::info!(url = %url, "Subscribing to OpenCode SSE events");

    let dispatcher = AcpUiEventDispatcher::new(Some(app_handle), DispatchPolicy::default());
    let handle = tokio::spawn(async move {
        let mut reconnect_attempt = 0u32;

        loop {
            if cancel_token.is_cancelled() {
                tracing::info!("SSE subscription cancelled before reconnect");
                break;
            }

            clear_all_message_roles();

            match connect_and_process_stream(&url, &dispatcher, &cancel_token).await {
                Ok(()) => {
                    if cancel_token.is_cancelled() {
                        tracing::info!("SSE subscription cancelled");
                        break;
                    }
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    tracing::warn!(
                        reconnect_attempt,
                        "OpenCode SSE stream closed, scheduling reconnect"
                    );
                }
                Err(error) => {
                    if cancel_token.is_cancelled() {
                        tracing::info!("SSE subscription cancelled during reconnect");
                        break;
                    }
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    tracing::error!(
                        reconnect_attempt,
                        %error,
                        "OpenCode SSE stream failed, scheduling reconnect"
                    );
                }
            }

            let delay = reconnect_delay(reconnect_attempt);
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    tracing::info!("SSE reconnect cancelled");
                    break;
                }
                _ = tokio::time::sleep(delay) => {}
            }
        }

        tracing::info!("SSE event supervisor ended");
    });

    Ok(handle)
}

#[cfg(test)]
mod tests;
