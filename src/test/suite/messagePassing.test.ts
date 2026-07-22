import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { SqlExplorerPanel } from '../../SqlExplorerPanel';

suite('SqlExplorerPanel Message Passing Test Suite', () => {
    let context: vscode.ExtensionContext;
    let panel: SqlExplorerPanel;

    suiteSetup(() => {
        // Create a dummy extension context for testing
        context = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                setKeysForSync: () => {},
                keys: () => []
            },
            extensionUri: vscode.Uri.file(__dirname),
            extensionPath: __dirname,
            environmentVariableCollection: {} as any,
            asAbsolutePath: (relativePath: string) => relativePath,
            storageUri: vscode.Uri.file(__dirname),
            globalStorageUri: vscode.Uri.file(__dirname),
            logUri: vscode.Uri.file(__dirname),
            extensionMode: vscode.ExtensionMode.Test,
            extension: {
                id: 'test.extension',
                extensionUri: vscode.Uri.file(__dirname),
                extensionPath: __dirname,
                isActive: true,
                packageJSON: {},
                extensionKind: vscode.ExtensionKind.UI,
                exports: undefined,
                activate: () => Promise.resolve()
            }
        } as unknown as vscode.ExtensionContext;
    });

    setup(() => {
        // Ensure we start with a clean slate
        if (SqlExplorerPanel.currentPanel) {
            SqlExplorerPanel.currentPanel.dispose();
        }
        
        // Create the panel
        SqlExplorerPanel.createOrShow(context);
        panel = SqlExplorerPanel.currentPanel!;
    });

    teardown(() => {
        // Restore all sinon stubs and spies
        sinon.restore();
        if (SqlExplorerPanel.currentPanel) {
            SqlExplorerPanel.currentPanel.dispose();
        }
    });

    test('Should handle downloadResults message by showing a save dialog', async () => {
        // 1. Stub the VS Code showSaveDialog API to return undefined (simulating user cancellation)
        const saveDialogStub = sinon.stub(vscode.window, 'showSaveDialog').resolves(undefined);

        // 2. Construct our mock message that would normally come from the Webview
        const mockMessage = {
            type: 'downloadResults',
            format: 'csv',
            data: [1, 2, 3, 4] // Dummy byte data
        };

        // 3. Call the private _handleMessage method directly
        await (panel as any)._handleMessage(mockMessage);

        // 4. Assert that our stubs were called with the expected arguments
        assert.ok(saveDialogStub.calledOnce, 'showSaveDialog should have been called');
        
        const saveOptions = saveDialogStub.firstCall.args[0];
        assert.ok(saveOptions?.filters?.['CSV'], 'Save dialog should filter by CSV');
    });

    test('Should handle error message by showing an error dialog', async () => {
        // 1. Stub the VS Code showErrorMessage API
        const errorMessageStub = sinon.stub(vscode.window, 'showErrorMessage').resolves();

        // 2. Construct mock error message
        const mockMessage = {
            type: 'error',
            error: 'Failed to execute query: syntax error'
        };

        // 3. Call the private handler
        await (panel as any)._handleMessage(mockMessage);

        // 4. Assert
        assert.ok(errorMessageStub.calledOnce, 'showErrorMessage should have been called');
        assert.strictEqual(
            errorMessageStub.firstCall.args[0], 
            'SQL Explorer Error: Failed to execute query: syntax error'
        );
    });
});
