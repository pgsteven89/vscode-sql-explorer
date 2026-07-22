import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('File Types Support Test Suite', () => {
    vscode.window.showInformationMessage('Starting File Types tests.');

    const fixturesPath = path.resolve(__dirname, '../../../src/test/fixtures');

    // Make sure fixtures exist before testing
    suiteSetup(() => {
        if (!fs.existsSync(fixturesPath)) {
            assert.fail('Fixtures directory not found: ' + fixturesPath);
        }
    });

    const fileTypes = [
        'sample.csv',
        'sample.json',
        'sample.jsonl',
        'sample.ndjson',
        'sample.parquet',
        'sample.sqlite',
        'sample.xlsx'
    ];

    for (const file of fileTypes) {
        test(`Should be able to open and process ${file}`, async () => {
            const filePath = path.join(fixturesPath, file);
            if (!fs.existsSync(filePath)) {
                // If fixture is missing, skip or fail. For now, we expect them to exist.
                assert.fail(`Fixture missing: ${file}`);
            }

            const uri = vscode.Uri.file(filePath);
            
            // Execute the addFile command to verify it doesn't throw
            try {
                await vscode.commands.executeCommand('sqlExplorer.addFile', uri);
                assert.ok(true, `Successfully added ${file}`);
            } catch (error: any) {
                assert.fail(`Failed to process ${file}: ${error.message}`);
            }
        });
    }
});
