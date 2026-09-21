import * as vscode from 'vscode';
import { Message, FileType } from './messages';
import { getResultsProvider } from './extension';

export class SqlExplorerPanel {
    public static currentPanel: SqlExplorerPanel | undefined;
    public static readonly viewType = 'sqlExplorer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    private _isReady: boolean = false;
    private _messageQueue: Message[] = [];

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (SqlExplorerPanel.currentPanel) {
            SqlExplorerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            SqlExplorerPanel.viewType,
            'SQL Explorer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'assets'),
                    ...(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(f => f.uri) : [])
                ],
            }
        );

        SqlExplorerPanel.currentPanel = new SqlExplorerPanel(panel, context);
    }

    public static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
        SqlExplorerPanel.currentPanel = new SqlExplorerPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;
        this._extensionUri = context.extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message: Message) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    private postMessageSafely(message: Message) {
        if (this._isReady) {
            this._panel.webview.postMessage(message);
        } else {
            this._messageQueue.push(message);
        }
    }

    public async addFile(uri: vscode.Uri): Promise<void> {
        try {
            const fileName = uri.path.split('/').pop() || 'unknown';
            const fileType = this._getFileType(fileName);

            const fileDir = vscode.Uri.joinPath(uri, '..');
            const currentRoots = this._panel.webview.options.localResourceRoots || [];
            
            const isAlreadyRoot = currentRoots.some(root => root.toString() === fileDir.toString());
            
            if (!isAlreadyRoot) {
                // Updating options reloads the webview. We must reset _isReady.
                this._isReady = false;
                this._panel.webview.options = {
                    ...this._panel.webview.options,
                    localResourceRoots: [...currentRoots, fileDir]
                };
            }

            const webviewUri = this._panel.webview.asWebviewUri(uri).toString();

            this.postMessageSafely({
                type: 'addFile',
                fileName: fileName,
                webviewUri: webviewUri,
                fileType: fileType,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load file: ${error}`);
        }
    }

    private _getFileType(fileName: string): FileType {
        const ext = fileName.toLowerCase().split('.').pop();
        switch (ext) {
            case 'csv': return 'csv';
            case 'parquet': return 'parquet';
            case 'xlsx':
            case 'xls': return 'xlsx';
            case 'sqlite':
            case 'db': return 'sqlite';
            case 'json':
            case 'jsonl':
            case 'ndjson': return 'json';
            default: return 'csv';
        }
    }

    private async _handleMessage(message: Message): Promise<void> {
        console.log('SqlExplorerPanel._handleMessage received:', message.type, message);

        switch (message.type) {
            case 'ready':
                console.log('Webview is ready');
                this._isReady = true;
                
                // Process queued messages
                while (this._messageQueue.length > 0) {
                    const msg = this._messageQueue.shift();
                    if (msg) {
                        this._panel.webview.postMessage(msg);
                    }
                }

                const lastQuery = this._context.workspaceState.get<string>('sqlExplorer.lastQuery');
                if (lastQuery) {
                    this.postMessageSafely({ type: 'restoreQuery', query: lastQuery });
                }
                break;
            case 'downloadResults':
                await this._handleDownload(message);
                break;
            case 'error':
                vscode.window.showErrorMessage(`SQL Explorer Error: ${message.error}`);
                break;
            case 'pickFile':
                await this._handlePickFile();
                break;
            case 'saveQueryState':
                if (message.query) {
                    await this._context.workspaceState.update('sqlExplorer.lastQuery', message.query);
                }
                break;
            case 'queryResult':
                console.log('Received queryResult, forwarding to results panel');
                const resultsProvider = getResultsProvider();
                console.log('Results provider:', resultsProvider ? 'exists' : 'null');
                if (resultsProvider) {
                    const msg = message as any;
                    console.log('Forwarding results:', {
                        columns: msg.columns?.length,
                        rows: msg.rows?.length,
                        totalRows: msg.totalRows
                    });
                    resultsProvider.showResults({
                        columns: msg.columns,
                        rows: msg.rows,
                        totalRows: msg.totalRows,
                        executionTime: msg.executionTime,
                        isTruncated: msg.isTruncated,
                    });
                }
                break;
            case 'queryError':
                const errorProvider = getResultsProvider();
                if (errorProvider) {
                    errorProvider.showError((message as any).error);
                }
                break;
        }
    }

    public async requestExport(format: 'csv' | 'parquet'): Promise<void> {
        // Request the webview to export current results
        this._panel.webview.postMessage({
            type: 'requestExport',
            format: format,
        } as Message);
    }

    private async _handlePickFile(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: {
                'Data Files': ['csv', 'parquet', 'xlsx', 'xls', 'sqlite', 'db', 'json', 'jsonl', 'ndjson'],
                'All Files': ['*'],
            },
        });

        if (uris) {
            for (const uri of uris) {
                await this.addFile(uri);
            }
        }
    }

    private async _handleDownload(message: Message): Promise<void> {
        if (message.type !== 'downloadResults') { return; }

        const uri = await vscode.window.showSaveDialog({
            filters: {
                'CSV': ['csv'],
                'Parquet': ['parquet'],
            },
            defaultUri: vscode.Uri.file(`query_results.${message.format}`),
        });

        if (uri && message.data) {
            const data = new Uint8Array(message.data);
            await vscode.workspace.fs.writeFile(uri, data);
            vscode.window.showInformationMessage(`Results saved to ${uri.fsPath}`);
        }
    }

    private _update(): void {
        this._panel.title = 'SQL Explorer';
        this._panel.webview.html = this._getWebviewContent();
    }

    private _getWebviewContent(): string {
        const webview = this._panel.webview;

        // URIs for resources
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
        );
        const assetsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'assets')
        );
        const monacoUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'assets', 'monaco')
        );

        // Use a nonce for inline scripts
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval' 'nonce-${nonce}';
        worker-src ${webview.cspSource} blob:;
        img-src ${webview.cspSource} data:;
        font-src ${webview.cspSource};
        connect-src ${webview.cspSource} blob: data: https://extensions.duckdb.org;
    ">
    <link href="${styleUri}" rel="stylesheet">
    <title>SQL Explorer</title>
</head>
<body>
    <div id="vscode-sql-explorer-config" 
         data-assets-uri="${assetsUri}" 
         data-monaco-uri="${monacoUri}" 
         style="display:none;"></div>
    <div id="app">
        <div id="sidebar">
            <div class="sidebar-header">
                <h2>Tables</h2>
                <button id="add-file-btn" title="Add Files">+</button>
            </div>
            <div id="drop-zone" class="drop-zone">
                <div class="drop-zone-content">
                    <span class="drop-icon">📁</span>
                    <span>Drop files here</span>
                    <span class="drop-hint">CSV, Parquet, XLSX, SQLite</span>
                </div>
            </div>
            <div id="schema-explorer"></div>
            <div class="sidebar-header" style="margin-top: 10px;">
                <h2>Query History</h2>
            </div>
            <div id="query-history-list" class="history-list"></div>
        </div>
        <div id="main-content">
            <div class="editor-tabs" id="editor-tabs">
                <div class="tabs-container" id="tabs-container"></div>
                <button id="add-tab-btn" class="icon-btn" title="New Tab">+</button>
            </div>
            <div id="editor-panel" class="full-height">
                <div class="editor-toolbar">
                    <button id="run-btn" class="primary-btn" title="Run Query (Ctrl+Enter)">
                        ▶ Run
                    </button>
                    <button id="format-btn" class="secondary-btn" title="Format SQL (Shift+Alt+F)">
                        Format SQL
                    </button>
                    <button id="settings-btn" class="secondary-btn" title="Settings">
                        ⚙️ Settings
                    </button>
                    <span id="query-status"></span>
                </div>
                <div id="sql-editor"></div>
            </div>
        </div>
    </div>
    <div id="loading-overlay" class="hidden">
        <div class="loading-spinner"></div>
        <span>Initializing DuckDB...</span>
    </div>
    <div id="settings-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Settings</h2>
                <button id="close-settings-btn" class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="max-rows-input">Max Rows to Return:</label>
                    <input type="number" id="max-rows-input" min="1" max="1000000" value="10000" />
                </div>
            </div>
            <div class="modal-footer">
                <button id="save-settings-btn" class="primary-btn">Save</button>
            </div>
        </div>
    </div>
    <script type="module" src="${scriptUri}" nonce="${nonce}"></script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public dispose(): void {
        SqlExplorerPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
