use super::*;
use crate::acp::client_transport::apply_interaction_response_for_request;

impl AcpClient {
    /// Send a JSON-RPC request and wait for response
    pub(super) async fn send_request(&mut self, method: &str, params: Value) -> AcpResult<Value> {
        client_rpc::send_request(
            &self.request_id,
            &self.pending_requests,
            &self.stdin_writer,
            self.process_generation,
            method,
            params,
            REQUEST_TIMEOUT_SECS,
        )
        .await
    }

    /// Send a JSON-RPC response to an inbound request
    ///
    /// This is used to respond to requests from the ACP subprocess,
    /// such as `client/requestPermission` for tool approval.
    pub async fn respond(&self, id: u64, result: Value) -> AcpResult<()> {
        client_rpc::respond(&self.stdin_writer, id, result).await
    }

    /// Send a JSON-RPC response to an inbound request, with permission tracking.
    ///
    /// Inspects the result payload for `outcome.outcome == "cancelled"` to detect
    /// user denial. On deny, emits a synthetic `ToolCallUpdate(Failed)` so the
    /// tool card transitions from in-progress to failed in the UI.
    /// On allow or for non-permission requests, just cleans up the tracker entry.
    pub async fn respond_with_permission_tracking(&self, id: u64, result: Value) -> AcpResult<()> {
        let provider = self.provider.clone();
        let adapted_result = match self.inbound_response_adapters.lock() {
            Ok(mut adapters) => adapters
                .remove(&id)
                .map(|adapter| {
                    provider
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

        self.respond(id, adapted_result.clone()).await?;
        self.update_interaction_projection(id, &adapted_result)
            .await;

        // Check if this request was tracked as a permission
        let ctx = match self.permission_tracker.lock() {
            Ok(mut tracker) => tracker.resolve(id),
            Err(e) => {
                tracing::error!("Permission tracker mutex poisoned in resolve: {e}");
                None
            }
        };

        if let Some(ctx) = ctx {
            // Detect denial from the result payload
            let outcome_str = adapted_result
                .pointer("/outcome/outcome")
                .and_then(|v| v.as_str());
            let is_denied = outcome_str.is_some_and(|o| o == "cancelled");

            if let Some(o) = outcome_str {
                if o != "cancelled" && o != "allowed" && o != "selected" {
                    tracing::warn!(outcome = o, tool_call_id = %ctx.tool_call_id, "Unrecognized permission outcome");
                }
            }

            if is_denied {
                if let Some(ref dispatcher) = self.dispatcher {
                    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: ctx.tool_call_id,
                            status: Some(ToolCallStatus::Failed),
                            failure_reason: Some("Permission denied by user".into()),
                            ..Default::default()
                        },
                        session_id: Some(ctx.session_id),
                    }));
                }
            }
        }

        Ok(())
    }

    pub(super) async fn update_interaction_projection(
        &self,
        request_id: u64,
        adapted_result: &Value,
    ) {
        let session_id = match self.active_session_id.lock() {
            Ok(active_session_id) => active_session_id.clone(),
            Err(error) => {
                tracing::error!("Active session mutex poisoned in resolve: {error}");
                None
            }
        };
        let Some(session_id) = session_id else {
            return;
        };

        apply_interaction_response_for_request(
            &self.projection_registry,
            self.db.as_ref(),
            self.dispatcher.as_ref(),
            &session_id,
            request_id,
            adapted_result,
            "acp client",
        )
        .await;
    }
}
