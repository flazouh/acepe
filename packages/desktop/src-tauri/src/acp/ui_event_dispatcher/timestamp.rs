use super::*;

pub(super) fn stamp_agent_message_chunk_timestamp(
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
    update: SessionUpdate,
) -> SessionUpdate {
    match update {
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            parent_tool_use_id,
            session_id: Some(session_id),
            produced_at_monotonic_ms: None,
        } => SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            parent_tool_use_id,
            session_id: Some(session_id.clone()),
            produced_at_monotonic_ms: Some(
                runtime_graph_registry.record_chunk_timestamp(&session_id),
            ),
        },
        other => other,
    }
}

pub(super) fn stamp_session_update_event(
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
    event: AcpUiEvent,
) -> AcpUiEvent {
    let AcpUiEvent {
        session_id,
        event_name,
        payload,
        priority,
        droppable,
        created_at,
    } = event;
    let payload = match payload {
        AcpUiEventPayload::SessionUpdate(update) => AcpUiEventPayload::SessionUpdate(Box::new(
            stamp_agent_message_chunk_timestamp(runtime_graph_registry, *update),
        )),
        other => other,
    };
    AcpUiEvent {
        session_id,
        event_name,
        payload,
        priority,
        droppable,
        created_at,
    }
}
