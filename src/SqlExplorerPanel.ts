import * as vscode from 'vscode';
import { Message, FileType } from './messages';
import { getResultsProvider } from './extension';

export class SqlExplorerPanel {
    public static currentPanel: SqlExplorerPanel | undefined;
    public static readonly viewType = 'sqlExplorer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SqlExplorerPanel.currentPanel) {
            SqlExplorerPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            SqlExplorerPanel.viewType,
            'SQL Explorer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'assets'),
                ],
            }
        );

        SqlExplorerPanel.currentPanel = new SqlExplorerPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message: Message) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    public async addFile(uri: vscode.Uri): Promise<void> {
        try {
            const fileName = uri.path.split('/').pop() || 'unknown';
            const fileData = await vscode.workspace.fs.readFile(uri);
            const fileType = this._getFileType(fileName);

            // Send file to webview
            this._panel.webview.postMessage({
                type: 'addFile',
                fileName: fileName,
                fileData: Array.from(fileData), // Convert Uint8Array to array for serialization
                fileType: fileType,
            } as Message);
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
            case 'json': return 'json';
            default: return 'csv';
        }
    }

    private async _handleMessage(message: Message): Promise<void> {
        console.log('SqlExplorerPanel._handleMessage received:', message.type, message);

        switch (message.type) {
            case 'ready':
                console.log('Webview is ready');
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
            case 'queryResult':
                // Forward query results to the results panel
                console.log('Received queryResult, forwarding to results panel');
                const resultsProvider = getResultsProvider();
                console.log('Results provider:', resultsProvider ? 'exists' : 'null');
                if (resultsProvider) {
                    // Access properties directly from the message object
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
                // Forward query error to the results panel
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
                'Data Files': ['csv', 'parquet', 'xlsx', 'xls', 'sqlite', 'db', 'json'],
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
        connect-src ${webview.cspSource} blob: data:;
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
        </div>
        <div id="main-content">
            <div id="editor-panel" class="full-height">
                <div class="editor-toolbar">
                    <button id="run-btn" class="primary-btn" title="Run Query (Ctrl+Enter)">
                        ▶ Run
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
