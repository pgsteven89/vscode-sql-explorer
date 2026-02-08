import * as vscode from 'vscode';

export interface ResultData {
    columns: { name: string; type: string }[];
    rows: unknown[][];
    totalRows: number;
    executionTime?: number;
    isTruncated?: boolean;
}

export class SqlResultsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sqlExplorer.results';

    private _view?: vscode.WebviewView;
    private _pendingResults?: ResultData;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'assets'),
            ],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the results webview
        webviewView.webview.onDidReceiveMessage((message) => {
            this._handleMessage(message);
        });

        // If there are pending results from before the view was visible, show them now
        if (this._pendingResults) {
            this.showResults(this._pendingResults);
            this._pendingResults = undefined;
        }

        // Handle visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && this._pendingResults) {
                this.showResults(this._pendingResults);
                this._pendingResults = undefined;
            }
        });
    }

    public showResults(data: ResultData): void {
        console.log('SqlResultsViewProvider.showResults called', {
            hasView: !!this._view,
            isVisible: this._view?.visible,
            rowCount: data.totalRows
        });

        if (this._view) {
            // Always try to show the view first
            this._view.show?.(true);

            // Send data to the webview
            this._view.webview.postMessage({
                type: 'showResults',
                data: data,
            });
        } else {
            // View hasn't been resolved yet, store for later
            console.log('View not resolved yet, storing pending results');
            this._pendingResults = data;
        }

        // Always try to focus the panel to make it visible
        void vscode.commands.executeCommand('sqlExplorer.results.focus');
    }

    public showError(error: string): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'showError',
                error: error,
            });
        }
    }

    public showStatus(status: string): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'showStatus',
                status: status,
            });
        }
    }

    private _handleMessage(message: { type: string; format?: string; data?: number[] }): void {
        switch (message.type) {
            case 'downloadResults':
                // Forward download request to be handled by the main extension
                vscode.commands.executeCommand(
                    'sqlExplorer.internal.handleDownload',
                    message.format,
                    message.data
                );
                break;
            case 'ready':
                // Results view is ready
                if (this._pendingResults) {
                    this.showResults(this._pendingResults);
                    this._pendingResults = undefined;
                }
                break;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'results-panel.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'results-panel.js')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource};
    ">
    <link href="${styleUri}" rel="stylesheet">
    <title>SQL Results</title>
</head>
<body>
    <div id="results-container">
        <div class="results-toolbar">
            <span id="results-info">No results yet</span>
            <div class="results-actions">
                <button id="download-csv-btn" disabled>Download CSV</button>
                <button id="download-parquet-btn" disabled>Download Parquet</button>
            </div>
        </div>
        <div id="results-grid">
            <div class="empty-state">
                <span class="empty-icon">📊</span>
                <span>Run a query to see results here</span>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
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
}
