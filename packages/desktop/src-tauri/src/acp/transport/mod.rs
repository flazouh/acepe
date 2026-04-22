pub mod adapter;
pub mod connection;
pub mod events;
pub mod preview;

#[cfg(test)]
mod adapter_tests;

pub use adapter::{
    ConnectRequest, ForkRequest, ResumePolicy, ResumeRequest, RetryBackoffHint, RetryDisposition,
    TransportAdapter,
};
pub use connection::{
    TransportCommand, TransportCommandSink, TransportConnection, TransportEventStream,
};
pub use events::{
    CapabilityFreshness, CapabilityProvenance, ConnectionFailure, TransportCapabilitySnapshot,
    TransportConnectResponse, TransportDisconnect, TransportEvent,
};
pub use preview::{PreviewAdapter, PreviewRequest};
