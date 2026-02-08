import * as vscode from 'vscode';
import { SqlExplorerPanel } from './SqlExplorerPanel';
import { SqlResultsViewProvider, ResultData } from './SqlResultsViewProvider';

// Global reference to the results provider for cross-panel communication
let resultsProvider: SqlResultsViewProvider | undefined;

export function getResultsProvider(): SqlResultsViewProvider | undefined {
    return resultsProvider;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('SQL Explorer extension is now active!');

    // Create and register the results panel view provider
    resultsProvider = new SqlResultsViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SqlResultsViewProvider.viewType,
            resultsProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    // Register the open panel command
    const openCommand = vscode.commands.registerCommand('sqlExplorer.open', () => {
        SqlExplorerPanel.createOrShow(context.extensionUri);
    });

    // Register the add file command (from context menu)
    const addFileCommand = vscode.commands.registerCommand('sqlExplorer.addFile', async (uri: vscode.Uri) => {
        // Ensure panel is open
        SqlExplorerPanel.createOrShow(context.extensionUri);

        // Add the file to the panel
        if (SqlExplorerPanel.currentPanel && uri) {
            await SqlExplorerPanel.currentPanel.addFile(uri);
        }
    });

    // Register focus results command
    const focusResultsCommand = vscode.commands.registerCommand('sqlExplorer.focusResults', () => {
        vscode.commands.executeCommand('sqlExplorer.results.focus');
    });

    // Register internal download handler command
    const handleDownloadCommand = vscode.commands.registerCommand(
        'sqlExplorer.internal.handleDownload',
        async (format: 'csv' | 'parquet', data?: number[]) => {
            // Request the main panel to export the current query results
            if (SqlExplorerPanel.currentPanel) {
                await SqlExplorerPanel.currentPanel.requestExport(format);
            }
        }
    );

    context.subscriptions.push(
        openCommand,
        addFileCommand,
        focusResultsCommand,
        handleDownloadCommand
    );

    // Handle files dropped onto the extension
    if (SqlExplorerPanel.currentPanel) {
        context.subscriptions.push(SqlExplorerPanel.currentPanel);
    }
}

export function deactivate() {
    // Cleanup if needed
}
