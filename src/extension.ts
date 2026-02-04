import * as vscode from 'vscode';
import { SqlExplorerPanel } from './SqlExplorerPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('SQL Explorer extension is now active!');

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

    context.subscriptions.push(openCommand, addFileCommand);

    // Handle files dropped onto the extension
    if (SqlExplorerPanel.currentPanel) {
        context.subscriptions.push(SqlExplorerPanel.currentPanel);
    }
}

export function deactivate() {
    // Cleanup if needed
}
