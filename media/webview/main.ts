/**
 * SQL Explorer Webview Main Entry Point
 */

import { DuckDBManager, TableSchema, QueryResult } from './duckdb-manager';
import { SchemaExplorer } from './components/schema-explorer';
import { SqlEditor } from './components/sql-editor';
import { ResultsGrid } from './components/results-grid';
import { DropZone } from './components/drop-zone';

// Declare VSCode API type
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

// Declare assets URI from inline script
declare const window: Window & { assetsUri: string; monacoUri: string };

type FileType = 'csv' | 'parquet' | 'xlsx' | 'sqlite' | 'json';

interface AddFileMessage {
    type: 'addFile';
    fileName: string;
    fileData: number[];
    fileType: FileType;
}

interface Message {
    type: string;
    [key: string]: unknown;
}

class SqlExplorerApp {
    private vscode = acquireVsCodeApi();
    private duckdb: DuckDBManager;
    private schemaExplorer: SchemaExplorer;
    private sqlEditor: SqlEditor;
    private resultsGrid: ResultsGrid;
    private dropZone: DropZone;
    private loadingOverlay: HTMLElement;
    private lastQueryResult: QueryResult | null = null;

    constructor() {
        this.loadingOverlay = document.getElementById('loading-overlay')!;

        // Initialize DuckDB Manager
        const configEl = document.getElementById('vscode-sql-explorer-config');
        const assetsUri = configEl?.getAttribute('data-assets-uri') || '';
        const monacoUri = configEl?.getAttribute('data-monaco-uri') || `${assetsUri}/monaco`;

        if (!assetsUri) {
            this.vscode.postMessage({ type: 'error', error: 'Critical Error: Configuration failed. assetsUri is missing.' } as any);
        }

        this.duckdb = new DuckDBManager(assetsUri);

        // Initialize components
        this.schemaExplorer = new SchemaExplorer(
            document.getElementById('schema-explorer')!,
            (text) => this.sqlEditor.insertText(text)
        );

        this.sqlEditor = new SqlEditor(
            document.getElementById('sql-editor')!,
            () => this.executeQuery(),
            monacoUri
        );

        this.resultsGrid = new ResultsGrid(
            document.getElementById('results-grid')!
        );

        this.dropZone = new DropZone(
            document.getElementById('drop-zone')!,
            (file) => this.handleDroppedFile(file)
        );

        this.setupEventListeners();
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            this.showLoading(true);
            await this.duckdb.initialize();
            this.showLoading(false);

            // Notify extension we're ready
            this.vscode.postMessage({ type: 'ready' });

            // Set default query
            this.sqlEditor.setValue('-- Write your SQL query here\n-- Drop a CSV, Parquet, or JSON file to get started\nSELECT * FROM your_table LIMIT 100;');
        } catch (error) {
            this.showLoading(false);
            this.showError(`Failed to initialize DuckDB: ${error}`);
        }
    }

    private setupEventListeners(): void {
        // Add file button
        document.getElementById('add-file-btn')?.addEventListener('click', () => {
            this.vscode.postMessage({ type: 'pickFile' });
        });

        // Run button
        document.getElementById('run-btn')?.addEventListener('click', () => {
            this.executeQuery();
        });

        // Download buttons
        document.getElementById('download-csv-btn')?.addEventListener('click', () => {
            this.downloadResults('csv');
        });

        document.getElementById('download-parquet-btn')?.addEventListener('click', () => {
            this.downloadResults('parquet');
        });

        // Messages from extension
        window.addEventListener('message', (event) => {
            this.handleExtensionMessage(event.data as Message);
        });

        // Handle window resize for Monaco editor layout
        window.addEventListener('resize', () => {
            this.sqlEditor.layout();
        });

        // Handle table removal from schema explorer
        document.getElementById('schema-explorer')?.addEventListener('removeTable', async (event) => {
            const customEvent = event as CustomEvent<{ tableName: string }>;
            const tableName = customEvent.detail.tableName;
            try {
                await this.duckdb.removeTable(tableName);
                // Update SQL editor autocomplete after removal
                const schemas = await this.duckdb.getTableSchemas();
                this.sqlEditor.updateTableInfo(schemas.map(s => ({
                    name: s.name,
                    columns: s.columns
                })));
                this.setQueryStatus(`Removed table "${tableName}"`);
            } catch (error) {
                this.showError(`Failed to remove table: ${error}`);
            }
        });
    }

    private async handleExtensionMessage(message: Message): Promise<void> {
        switch (message.type) {
            case 'addFile':
                await this.handleAddFile(message as unknown as AddFileMessage);
                break;
        }
    }

    private async handleAddFile(message: AddFileMessage): Promise<void> {
        try {
            const fileData = new Uint8Array(message.fileData);
            const tableName = this.sanitizeTableName(message.fileName);

            this.setQueryStatus(`Loading ${message.fileName}...`);

            await this.duckdb.registerFile(tableName, fileData, message.fileType, message.fileName);

            // Update schema explorer and SQL editor autocomplete
            const schemas = await this.duckdb.getTableSchemas();
            this.schemaExplorer.update(schemas);
            this.sqlEditor.updateTableInfo(schemas.map(s => ({
                name: s.name,
                columns: s.columns
            })));

            this.setQueryStatus(`Loaded ${message.fileName} as "${tableName}"`);
        } catch (error) {
            this.showError(`Failed to load file: ${error}`);
        }
    }

    private async handleDroppedFile(file: File): Promise<void> {
        try {
            const arrayBuffer = await file.arrayBuffer();
            let data: Uint8Array = new Uint8Array(arrayBuffer);

            // Fallback to FileReader if arrayBuffer returns empty
            if (data.length === 0 && file.size > 0) {
                data = new Uint8Array(await this.readFileWithFileReader(file));
                if (data.length === 0) {
                    throw new Error('Cannot read file data. Try using the "+" button instead.');
                }
            }

            const tableName = this.sanitizeTableName(file.name);
            const fileType = this.getFileType(file.name);

            this.setQueryStatus(`Loading ${file.name}...`);

            await this.duckdb.registerFile(tableName, data, fileType, file.name);

            // Update schema explorer and SQL editor autocomplete
            const schemas = await this.duckdb.getTableSchemas();
            this.schemaExplorer.update(schemas);
            this.sqlEditor.updateTableInfo(schemas.map(s => ({
                name: s.name,
                columns: s.columns
            })));

            this.setQueryStatus(`Loaded ${file.name} as "${tableName}"`);
        } catch (error) {
            this.showError(`Failed to load file: ${error}`);
        }
    }

    private readFileWithFileReader(file: File): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as ArrayBuffer;
                resolve(new Uint8Array(result));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    private async executeQuery(): Promise<void> {
        const sql = this.sqlEditor.getValue().trim();
        if (!sql) {
            return;
        }

        try {
            const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
            runBtn.disabled = true;
            this.setQueryStatus('Executing query...');

            const startTime = performance.now();
            const result = await this.duckdb.executeQuery(sql);
            const endTime = performance.now();

            result.executionTime = endTime - startTime;
            this.lastQueryResult = result;

            // Update results grid
            this.resultsGrid.render(result);

            // Update status
            const formattedTime = result.executionTime.toFixed(0);
            this.setResultsInfo(`${result.totalRows.toLocaleString()} rows (${formattedTime}ms)`);
            this.setQueryStatus('Query completed');

            // Enable download buttons
            this.setDownloadButtonsEnabled(true);

            runBtn.disabled = false;
        } catch (error) {
            const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
            runBtn.disabled = false;
            this.setQueryStatus('Query failed');
            this.resultsGrid.showError(String(error));
            this.setDownloadButtonsEnabled(false);
        }
    }

    private async downloadResults(format: 'csv' | 'parquet'): Promise<void> {
        const sql = this.sqlEditor.getValue().trim();
        if (!sql) {
            return;
        }

        try {
            this.setQueryStatus(`Exporting as ${format.toUpperCase()}...`);
            const data = await this.duckdb.exportResults(sql, format);

            // Send to extension for download
            this.vscode.postMessage({
                type: 'downloadResults',
                format: format,
                data: Array.from(data),
            });

            this.setQueryStatus('Export complete');
        } catch (error) {
            this.showError(`Export failed: ${error}`);
        }
    }

    private sanitizeTableName(fileName: string): string {
        // Remove extension and sanitize for SQL
        const baseName = fileName.replace(/\.[^.]+$/, '');
        return baseName
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/^[0-9]/, '_$&')
            .toLowerCase();
    }

    private getFileType(fileName: string): FileType {
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

    private showLoading(show: boolean): void {
        this.loadingOverlay.classList.toggle('hidden', !show);
    }

    private showError(message: string): void {
        this.vscode.postMessage({ type: 'error', error: message });
        console.error(message);
    }

    private setQueryStatus(status: string): void {
        const el = document.getElementById('query-status');
        if (el) {
            el.textContent = status;
        }
    }

    private setResultsInfo(info: string): void {
        const el = document.getElementById('results-info');
        if (el) {
            el.textContent = info;
        }
    }

    private setDownloadButtonsEnabled(enabled: boolean): void {
        const csvBtn = document.getElementById('download-csv-btn') as HTMLButtonElement;
        const parquetBtn = document.getElementById('download-parquet-btn') as HTMLButtonElement;
        if (csvBtn) { csvBtn.disabled = !enabled; }
        if (parquetBtn) { parquetBtn.disabled = !enabled; }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SqlExplorerApp();
});
