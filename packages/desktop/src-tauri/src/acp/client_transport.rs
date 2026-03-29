use crate::acp::client::PendingRequestEntry;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::permission_tracker::PermissionTracker;
use crate::acp::session_update::{SessionUpdate, ToolCallStatus, ToolCallUpdateData};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use crate::acp::{cursor_extensions::CursorResponseAdapter, provider::AgentProvider};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc as StdArc;
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

pub(crate) fn truncate_for_log(line: &str, max_bytes: usize) -> String {
    if line.len() <= max_bytes {
        return line.to_string();
    }
    let head: String = line.chars().take(max_bytes).collect();
    format!("{head}… [truncated {} bytes]", line.len() - max_bytes)
}

fn subprocess_exit_error_response(reason: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "error": {
            "code": -32001,
            "message": reason
        }
    })
}

pub(crate) async fn fail_pending_requests(
    pending: &StdArc<Mutex<HashMap<u64, PendingRequestEntry>>>,
    process_generation: u64,
    reason: &str,
) {
    let mut locked = pending.lock().await;
    let failed_ids: Vec<u64> = locked
        .iter()
        .filter_map(|(id, entry)| {
            if entry.generation == process_generation {
                Some(*id)
            } else {
                None
            }
        })
        .collect();
    if failed_ids.is_empty() {
        return;
    }

    let response = subprocess_exit_error_response(reason);
    let pending_count = failed_ids.len();
    for id in failed_ids {
        let Some(entry) = locked.remove(&id) else {
            continue;
        };
        let _ = entry.sender.send(response.clone());
        tracing::warn!(id, reason = %reason, "Failing pending request due to subprocess termination");
    }
    tracing::warn!(pending_count, reason = %reason, "Failed pending ACP requests after subprocess termination");
}

pub(crate) fn drain_permissions_as_failed(
    permission_tracker: &StdArc<std::sync::Mutex<PermissionTracker>>,
    dispatcher: &AcpUiEventDispatcher,
) {
    let drained = match permission_tracker.lock() {
        Ok(mut tracker) => tracker.drain_all(),
        Err(e) => {
            tracing::error!("Permission tracker mutex poisoned in drain: {e}");
            return;
        }
    };
    for (_request_id, ctx) in drained {
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: ctx.tool_call_id,
                status: Some(ToolCallStatus::Failed),
                failure_reason: Some("Agent subprocess terminated".into()),
                ..Default::default()
            },
            session_id: Some(ctx.session_id),
        }));
    }
}

pub(crate) async fn write_serialized_line(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    payload: &str,
) -> AcpResult<()> {
    let mut guard = stdin_writer.lock().await;
    let stdin = guard.as_mut().ok_or(AcpError::ClientNotStarted)?;
    stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to write to stdin: {}", e)))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to write newline to stdin: {}", e)))?;
    stdin
        .flush()
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to flush stdin: {}", e)))?;
    Ok(())
}

pub(crate) async fn send_inbound_response(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    id: u64,
    result: Value,
) -> AcpResult<()> {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    });

    let response_str = serde_json::to_string(&response).map_err(AcpError::SerializationError)?;
    write_serialized_line(stdin_writer, &response_str).await
}

#[derive(Clone)]
pub(crate) struct InboundRequestResponder {
    pub provider: Option<StdArc<dyn AgentProvider>>,
    pub stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    pub permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    pub dispatcher: AcpUiEventDispatcher,
    pub inbound_response_adapters: StdArc<std::sync::Mutex<HashMap<u64, CursorResponseAdapter>>>,
}

impl InboundRequestResponder {
    pub async fn respond(&self, id: u64, result: Value) -> AcpResult<()> {
        let adapted_result = match self.inbound_response_adapters.lock() {
            Ok(mut adapters) => adapters
                .remove(&id)
                .map(|adapter| {
                    self.provider
                        .as_ref()
                        .map(|provider| provider.adapt_inbound_response(&adapter, &result))
                        .unwrap_or_else(|| result.clone())
                })
                .unwrap_or(result.clone()),
            Err(error) => {
                tracing::error!("Inbound response adapter mutex poisoned in resolve: {error}");
                result.clone()
            }
        };

        send_inbound_response(&self.stdin_writer, id, adapted_result.clone()).await?;

        let ctx = match self.permission_tracker.lock() {
            Ok(mut tracker) => tracker.resolve(id),
            Err(error) => {
                tracing::error!("Permission tracker mutex poisoned in resolve: {error}");
                None
            }
        };

        if let Some(ctx) = ctx {
            let outcome_str = adapted_result
                .pointer("/outcome/outcome")
                .and_then(|value| value.as_str());
            let is_denied = outcome_str.is_some_and(|outcome| outcome == "cancelled");

            if let Some(outcome) = outcome_str {
                if outcome != "cancelled" && outcome != "allowed" && outcome != "selected" {
                    tracing::warn!(outcome, tool_call_id = %ctx.tool_call_id, "Unrecognized permission outcome");
                }
            }

            if is_denied {
                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: ctx.tool_call_id,
                            status: Some(ToolCallStatus::Failed),
                            failure_reason: Some("Permission denied by user".into()),
                            ..Default::default()
                        },
                        session_id: Some(ctx.session_id),
                    },
                ));
            }
        }

        Ok(())
    }
}
