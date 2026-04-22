use std::pin::Pin;

use futures::{Stream, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::acp::error::{AcpError, AcpResult};
use crate::acp::transport::events::TransportEvent;
use crate::acp::types::PromptRequest;

pub type TransportEventStream = Pin<Box<dyn Stream<Item = TransportEvent> + Send>>;

#[derive(Debug)]
pub enum TransportCommand {
    SendPrompt { request: PromptRequest },
    Cancel { session_id: String },
    Respond { request_id: u64, result: Value },
}

#[derive(Debug, Clone)]
pub struct TransportCommandSink {
    sender: mpsc::UnboundedSender<TransportCommand>,
}

impl TransportCommandSink {
    #[must_use]
    pub fn new(sender: mpsc::UnboundedSender<TransportCommand>) -> Self {
        Self { sender }
    }

    pub fn send_prompt(&self, request: PromptRequest) -> AcpResult<()> {
        self.sender
            .send(TransportCommand::SendPrompt { request })
            .map_err(|error| {
                AcpError::ProtocolError(format!("Transport command channel closed: {error}"))
            })
    }

    pub fn cancel(&self, session_id: impl Into<String>) -> AcpResult<()> {
        self.sender
            .send(TransportCommand::Cancel {
                session_id: session_id.into(),
            })
            .map_err(|error| {
                AcpError::ProtocolError(format!("Transport command channel closed: {error}"))
            })
    }

    pub fn respond(&self, request_id: u64, result: Value) -> AcpResult<()> {
        self.sender
            .send(TransportCommand::Respond { request_id, result })
            .map_err(|error| {
                AcpError::ProtocolError(format!("Transport command channel closed: {error}"))
            })
    }
}

pub struct TransportConnection {
    commands: TransportCommandSink,
    events: TransportEventStream,
}

impl TransportConnection {
    #[must_use]
    pub fn new(commands: TransportCommandSink, events: TransportEventStream) -> Self {
        Self { commands, events }
    }

    #[must_use]
    pub fn command_sink(&self) -> TransportCommandSink {
        self.commands.clone()
    }

    pub async fn next_event(&mut self) -> Option<TransportEvent> {
        self.events.next().await
    }

    #[must_use]
    pub fn into_parts(self) -> (TransportCommandSink, TransportEventStream) {
        (self.commands, self.events)
    }
}
