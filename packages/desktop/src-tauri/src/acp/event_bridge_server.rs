use crate::acp::event_hub::{AcpEventBridgeInfo, AcpEventHubState};
use axum::extract::{Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    CACHE_CONTROL,
};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures::stream;
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    hub: Arc<AcpEventHubState>,
    token: String,
}

#[derive(Debug, Deserialize)]
struct EventsQuery {
    token: String,
}

pub async fn start_event_bridge_server(hub: Arc<AcpEventHubState>) -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let token = Uuid::new_v4().to_string();
    let port = local_addr.port();
    let events_url = format!("http://127.0.0.1:{port}/acp/events?token={token}");

    hub.set_bridge_info(AcpEventBridgeInfo { events_url }).await;

    let app_state = AppState {
        hub: hub.clone(),
        token,
    };

    let router = Router::new()
        .route("/acp/events", get(events_handler))
        .with_state(app_state);

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            tracing::error!(%error, "ACP event bridge server stopped");
        }
    });

    Ok(())
}

async fn events_handler(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Response {
    if query.token != state.token {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let receiver = state.hub.subscribe();
    let stream = stream::unfold(receiver, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    let encoded = match serde_json::to_string(&envelope) {
                        Ok(encoded) => encoded,
                        Err(error) => {
                            tracing::error!(%error, "Failed to serialize ACP event envelope");
                            continue;
                        }
                    };
                    let event = Event::default().data(encoded);
                    return Some((Ok::<Event, Infallible>(event), rx));
                }
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "ACP event bridge lagged receiver");
                }
                Err(RecvError::Closed) => return None,
            }
        }
    });

    let sse = Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("heartbeat"),
    );

    let mut response = sse.into_response();
    response
        .headers_mut()
        .insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_str(Method::GET.as_str()).unwrap_or_else(|error| {
            tracing::error!(%error, "Failed to set CORS methods header");
            HeaderValue::from_static("GET")
        }),
    );
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));

    response
}
