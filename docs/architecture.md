# VSCode SQL Explorer - Architecture Document

## Overview

VSCode SQL Explorer is an extension that enables users to query data files (CSV, Parquet, XLSX, SQLite) using SQL directly within VSCode. It leverages DuckDB WASM for in-browser analytical queries.

## Core Concepts

### Extension Host vs Webview

The extension operates in two contexts:

1. **Extension Host** (Node.js): Handles VSCode integration, file system access, and extension lifecycle
2. **Webview** (Browser): Runs the UI and DuckDB WASM engine

Communication between them uses VSCode's message passing API.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        VSCode Extension Host                          │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                        extension.ts                               │ │
│  │  - Registers commands                                            │ │
│  │  - Creates webview panels                                        │ │
│  │  - Handles file system operations                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                 │                                      │
│                    postMessage / onDidReceiveMessage                   │
│                                 ▼                                      │
├──────────────────────────────────────────────────────────────────────┤
│                          Webview (Browser)                            │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐ │
│  │   Drop Zone     │ │  Schema Explorer │ │     SQL Editor          │ │
│  │   Component     │ │     Sidebar      │ │    (Monaco Editor)      │ │
│  └────────┬────────┘ └────────┬────────┘ └────────────┬────────────┘ │
│           │                   │                        │              │
│           └───────────────────┼────────────────────────┘              │
│                               ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      DuckDB Manager                               │ │
│  │  - Initializes DuckDB WASM                                       │ │
│  │  - Registers files as tables                                     │ │
│  │  - Executes SQL queries                                          │ │
│  │  - Exports results                                               │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                               │                                        │
│                               ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      Results Grid                                 │ │
│  │  - Virtual scrolling for large datasets                          │ │
│  │  - Column sorting/filtering                                      │ │
│  │  - Export to CSV/Parquet                                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Extension Core (`src/extension.ts`)

**Responsibilities:**
- Register the `sqlExplorer.open` command
- Create and manage the webview panel
- Handle file URIs dropped onto VSCode
- Read files from disk and send to webview

**Key APIs:**
- `vscode.window.createWebviewPanel()`
- `vscode.workspace.fs.readFile()`
- `webview.postMessage()` / `webview.onDidReceiveMessage()`

### 2. Webview Panel Provider (`src/SqlExplorerPanel.ts`)

**Responsibilities:**
- Generate webview HTML with proper CSP
- Configure `localResourceRoots` for assets
- Handle bidirectional message passing
- Restore panel state on reopen

### 3. DuckDB Manager (`media/webview/duckdb-manager.ts`)

**Responsibilities:**
- Initialize DuckDB WASM with proper bundles
- Register files as virtual tables
- Execute SQL and return Arrow results
- Manage database lifecycle

**Key Methods:**
```typescript
class DuckDBManager {
  async initialize(): Promise<void>
  async registerFile(name: string, data: Uint8Array, type: FileType): Promise<void>
  async executeQuery(sql: string): Promise<QueryResult>
  async getTableSchemas(): Promise<TableSchema[]>
  async exportResults(sql: string, format: 'csv' | 'parquet'): Promise<Blob>
}
```

### 4. UI Components

#### Drop Zone
- Handles dragover/drop events
- Validates file types (csv, parquet, xlsx, sqlite, db)
- Shows visual feedback during drag

#### Schema Explorer
- Tree view of loaded tables
- Shows columns with data types
- Click-to-insert table/column names

#### SQL Editor
- Monaco Editor instance
- SQL syntax highlighting  
- Autocomplete with table/column names
- Keyboard shortcuts (Ctrl/Cmd+Enter to execute)

#### Results Grid
- Virtual scrolling for 100k+ rows
- Configurable column widths
- Row selection
- Download buttons

## Data Flow

### Loading a File

```
User drops file → Extension reads file → Posts ArrayBuffer to webview
                                              ↓
                              DuckDB registers file as table
                                              ↓
                              Schema explorer updates
                                              ↓
                              User can query the table
```

### Executing a Query

```
User writes SQL → Clicks Execute (or Ctrl+Enter)
                        ↓
              DuckDB Manager executes query
                        ↓
              Results returned as Arrow table
                        ↓
              Results grid renders with virtual scrolling
```

## File Type Support

| Extension | DuckDB Function | Notes |
|-----------|-----------------|-------|
| .csv | `read_csv_auto()` | Auto-detects delimiter/headers |
| .parquet | `read_parquet()` | Native support, very fast |
| .xlsx | `st_read()` or SheetJS | Requires spatial extension or fallback |
| .sqlite, .db | `ATTACH` | Attaches as separate database |
| .json | `read_json_auto()` | JSON/NDJSON files |

## Security Considerations

### Content Security Policy

The webview uses a strict CSP:
```
default-src 'none';
style-src ${webview.cspSource} 'unsafe-inline';
script-src ${webview.cspSource} 'wasm-unsafe-eval';
img-src ${webview.cspSource} data:;
font-src ${webview.cspSource};
```

### Local Resource Roots

Only the `media/` folder is accessible to the webview:
```typescript
localResourceRoots: [
  vscode.Uri.joinPath(extensionUri, 'media')
]
```

## Performance Considerations

### DuckDB WASM Loading
- ~40MB total bundle size
- Lazy-load only when panel is opened
- Show loading indicator during initialization

### Large Result Sets
- Virtual scrolling renders only visible rows
- Keep ~100 rows in DOM at a time
- Use `requestAnimationFrame` for smooth scrolling

### Memory Management
- Stream large files when possible
- Warn users about files >500MB
- Consider pagination for very large results

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Extension | TypeScript | Type safety, VSCode API |
| Build | esbuild | Fast bundling |
| UI | Vanilla JS + CSS Variables | Lightweight, theme-aware |
| SQL Editor | Monaco Editor | Same as VSCode, familiar |
| SQL Engine | DuckDB WASM | Fast analytics, SQL standard |
| Virtual Scroll | Custom | Minimal dependencies |

## Future Enhancements

1. **Query History** - Save and recall previous queries
2. **Multiple Tabs** - Support multiple query tabs
3. **Query Sharing** - Export queries as .sql files
4. **Database Connections** - Connect to external PostgreSQL/MySQL
5. **Charting** - Basic visualization of results
6. **Saved Workspaces** - Remember loaded files across sessions
