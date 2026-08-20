use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const JSONRPC_VERSION: &str = "2.0";
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(serde_json::Number),
    String(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JsonRpcRequest {
    pub id: JsonRpcId,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum InboundLine {
    Request(JsonRpcRequest),
    Notification {
        method: String,
        params: Option<Value>,
    },
    Invalid {
        id: Option<JsonRpcId>,
        error: JsonRpcError,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum DispatchOutcome {
    Result(Value),
    Error(JsonRpcError),
}

pub fn parse_error(data: Option<Value>) -> JsonRpcError {
    JsonRpcError {
        code: PARSE_ERROR,
        message: "Parse error".to_string(),
        data,
    }
}

pub fn invalid_request(message: impl Into<String>, data: Option<Value>) -> JsonRpcError {
    JsonRpcError {
        code: INVALID_REQUEST,
        message: message.into(),
        data,
    }
}

pub fn method_not_found(method: &str) -> JsonRpcError {
    JsonRpcError {
        code: METHOD_NOT_FOUND,
        message: format!("Method not found: {method}"),
        data: Some(Value::String(method.to_string())),
    }
}

pub fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError {
        code: INVALID_PARAMS,
        message: message.into(),
        data: None,
    }
}

pub fn internal_error(message: impl Into<String>, data: Option<Value>) -> JsonRpcError {
    JsonRpcError {
        code: INTERNAL_ERROR,
        message: message.into(),
        data,
    }
}

pub fn parse_inbound_line(line: &str) -> InboundLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return InboundLine::Invalid {
            id: None,
            error: invalid_request("Empty JSON-RPC line", None),
        };
    }

    let value = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(error) => {
            return InboundLine::Invalid {
                id: None,
                error: parse_error(Some(Value::String(error.to_string()))),
            };
        }
    };

    decode_inbound_value(value)
}

fn decode_inbound_value(value: Value) -> InboundLine {
    let Some(object) = value.as_object() else {
        return InboundLine::Invalid {
            id: None,
            error: invalid_request("JSON-RPC message must be an object", None),
        };
    };

    let id = object
        .get("id")
        .and_then(|value| serde_json::from_value::<JsonRpcId>(value.clone()).ok());

    if object.get("jsonrpc").and_then(Value::as_str) != Some(JSONRPC_VERSION) {
        return InboundLine::Invalid {
            id,
            error: invalid_request("jsonrpc must be \"2.0\"", None),
        };
    }

    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return InboundLine::Invalid {
            id,
            error: invalid_request("JSON-RPC request is missing method", None),
        };
    };

    let params = object.get("params").cloned();
    if let Some(params) = params.as_ref() {
        if !params.is_object() && !params.is_null() {
            return InboundLine::Invalid {
                id,
                error: invalid_params("params must be an object"),
            };
        }
    }

    match id {
        Some(id) => InboundLine::Request(JsonRpcRequest {
            id,
            method: method.to_string(),
            params,
        }),
        None => InboundLine::Notification {
            method: method.to_string(),
            params,
        },
    }
}

pub fn success_response(id: JsonRpcId, result: Value) -> Value {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": id,
        "result": result
    })
}

pub fn error_response(id: Option<JsonRpcId>, error: JsonRpcError) -> Value {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": id,
        "error": error
    })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "method": method,
        "params": params
    })
}

pub fn notification_params(session_id: Option<String>, payload: Value, seq: Option<u64>) -> Value {
    let mut params = serde_json::Map::new();
    params.insert(
        "sessionId".to_string(),
        match session_id {
            Some(session_id) => Value::String(session_id),
            None => Value::Null,
        },
    );
    if let Some(seq) = seq {
        params.insert("seq".to_string(), json!(seq));
    }
    params.insert("payload".to_string(), payload);
    Value::Object(params)
}

pub fn session_id_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("sessionId")
        .or_else(|| payload.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub fn encode_line(value: &Value) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

/// Stdin EOF (or a stdin IO error) is the sidecar shutdown signal.
pub fn stdin_reached_eof(line: Option<Result<String, std::io::Error>>) -> bool {
    match line {
        Some(Ok(_)) => false,
        Some(Err(_)) | None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_named_request() {
        let inbound = parse_inbound_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"acp_initialize","params":{"x":true}}"#,
        );
        match inbound {
            InboundLine::Request(request) => {
                assert_eq!(request.method, "acp_initialize");
                assert_eq!(request.id, JsonRpcId::Number(serde_json::Number::from(1)));
                assert_eq!(request.params.unwrap()["x"], true);
            }
            other => panic!("expected request, got {other:?}"),
        }
    }

    #[test]
    fn parses_client_notification_without_id() {
        let inbound =
            parse_inbound_line(r#"{"jsonrpc":"2.0","method":"ping","params":{"ok":true}}"#);
        match inbound {
            InboundLine::Notification { method, params } => {
                assert_eq!(method, "ping");
                assert_eq!(params.unwrap()["ok"], true);
            }
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[test]
    fn rejects_malformed_json_as_parse_error() {
        let inbound = parse_inbound_line("{not json");
        match inbound {
            InboundLine::Invalid { id, error } => {
                assert!(id.is_none());
                assert_eq!(error.code, PARSE_ERROR);
            }
            other => panic!("expected invalid, got {other:?}"),
        }
    }

    #[test]
    fn rejects_array_params() {
        let inbound = parse_inbound_line(
            r#"{"jsonrpc":"2.0","id":"a","method":"acp_initialize","params":[1]}"#,
        );
        match inbound {
            InboundLine::Invalid { error, .. } => {
                assert_eq!(error.code, INVALID_PARAMS);
            }
            other => panic!("expected invalid params, got {other:?}"),
        }
    }

    #[test]
    fn success_response_keeps_request_id() {
        let encoded = success_response(JsonRpcId::String("req-1".to_string()), json!({"ok": true}));
        assert_eq!(encoded["jsonrpc"], JSONRPC_VERSION);
        assert_eq!(encoded["id"], "req-1");
        assert_eq!(encoded["result"]["ok"], true);
        assert!(encoded.get("error").is_none());
    }

    #[test]
    fn error_response_uses_null_id_when_unknown() {
        let encoded = error_response(None, parse_error(None));
        assert_eq!(encoded["id"], Value::Null);
        assert_eq!(encoded["error"]["code"], PARSE_ERROR);
    }

    #[test]
    fn notification_omits_id_and_tags_session() {
        let params = notification_params(
            Some("session-1".to_string()),
            json!({"type": "agentMessageChunk"}),
            Some(7),
        );
        let encoded = notification("acp-session-update", params);
        assert!(encoded.get("id").is_none());
        assert_eq!(encoded["method"], "acp-session-update");
        assert_eq!(encoded["params"]["sessionId"], "session-1");
        assert_eq!(encoded["params"]["seq"], 7);
        assert_eq!(encoded["params"]["payload"]["type"], "agentMessageChunk");
    }

    #[test]
    fn notification_uses_null_session_when_untagged() {
        let params = notification_params(None, json!({"branch": "main"}), None);
        assert_eq!(params["sessionId"], Value::Null);
        assert!(params.get("seq").is_none());
    }

    #[test]
    fn reads_session_id_from_camel_or_snake_payload() {
        assert_eq!(
            session_id_from_payload(&json!({"sessionId": "camel"})).as_deref(),
            Some("camel")
        );
        assert_eq!(
            session_id_from_payload(&json!({"session_id": "snake"})).as_deref(),
            Some("snake")
        );
        assert!(session_id_from_payload(&json!({"other": true})).is_none());
    }

    #[test]
    fn encode_line_is_single_ndjson_object() {
        let line = encode_line(&json!({"jsonrpc":"2.0","id":1,"result":null})).unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(line.chars().filter(|ch| *ch == '{').count(), 1);
    }

    #[test]
    fn stdin_eof_stops_the_sidecar() {
        assert!(stdin_reached_eof(None));
        assert!(stdin_reached_eof(Some(Err(std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            "closed"
        )))));
        assert!(!stdin_reached_eof(Some(Ok(
            r#"{"jsonrpc":"2.0","id":1,"method":"acp_initialize"}"#.to_string()
        ))));
    }
}
