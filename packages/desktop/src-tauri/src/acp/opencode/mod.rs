pub mod http_client;
/// OpenCode HTTP mode implementation
/// Provides HTTP REST API + SSE client for OpenCode agent
pub mod manager;
pub mod sse;

pub use http_client::OpenCodeHttpClient;
pub use manager::{OpenCodeManager, OpenCodeManagerRegistry};
