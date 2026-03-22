# Tauri Plugin: Model Context Protocol (MCP)

A Tauri plugin that exposes application internals (screenshots, DOM, JS execution, window management) over a Unix socket server for AI agent interaction.

### Features

#### Window Interaction
- **Take Screenshot**: Capture images of any Tauri window with configurable quality and size
- **Window Management**: Control window position, size, focus, minimize/maximize state
- **DOM Access**: Retrieve the HTML DOM content from webview windows

#### User Input Simulation
- **Mouse Movement**: Simulate mouse clicks, movements, and scrolling
- **Text Input**: Programmatically input text into focused elements
- **Execute JavaScript**: Run arbitrary JavaScript code in the application context

#### Data & Storage
- **Local Storage Management**: Get, set, remove, and clear localStorage entries
- **Ping**: Simple connectivity testing to verify the plugin is responsive

## Architecture

The Rust socket server (`socket_server.rs`) runs inside the Tauri app process:

- Creates a Unix socket (macOS/Linux) or named pipe (Windows)
- Listens for client connections
- Processes incoming JSON commands
- Executes Tauri API calls
- Returns results as JSON responses

## Usage

In `src-tauri/Cargo.toml`:
```toml
tauri-plugin-mcp = { path = "packages/tauri-plugin-mcp" }
```

Register the plugin:
```rust
#[cfg(debug_assertions)]
{
    tauri::Builder::default()
        .plugin(tauri_mcp::init_with_config(
            tauri_mcp::PluginConfig::new("APPLICATION_NAME".to_string())
                .start_socket_server(true)
                .socket_path("/tmp/tauri-mcp.sock")
        ));
}
```

## Status

The plugin is currently disabled in production builds. The Rust socket server is functional but has no active MCP bridge client.
