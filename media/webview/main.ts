/**
 * SQL Explorer Webview Main Entry Point
 */

import { DuckDBManager, TableSchema, QueryResult } from './duckdb-manager';
import { SchemaExplorer } from './components/schema-explorer';
import { SqlEditor } from './components/sql-editor';
import { DropZone } from './components/drop-zone';

// Get the VS Code API
const vscode = acquireVsCodeApi();

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
    webviewUri: string;
    fileType: FileType;
}

interface Message {
    type: string;
    [key: string]: unknown;
}

class SqlExplorerApp {
    private vscode = vscode;
    private duckdb: DuckDBManager;
    private schemaExplorer: SchemaExplorer;
    private sqlEditor: SqlEditor;
    private dropZone: DropZone;
    private loadingOverlay: HTMLElement;
    private lastQuerySql: string = '';
    private lastQueryResult: QueryResult | null = null;
    
    private tabs: { id: string, title: string, content: string, viewState: any }[] = [];
    private activeTabId: string | null = null;
    private queryHistory: { sql: string, timestamp: Date, result: QueryResult }[] = [];

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

        this.dropZone = new DropZone(
            document.getElementById('drop-zone')!,
            (file) => this.handleDroppedFile(file)
        );

        this.setupEventListeners();
        this.setupTabs();
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            this.showLoading(true);
            await this.duckdb.initialize();
            this.showLoading(false);

            // Notify extension we're ready
            this.vscode.postMessage({ type: 'ready' });
        } catch (error) {
            console.error('Failed to initialize DuckDB:', error);
            this.showError(`Failed to initialize DuckDB: ${error}`);
            
            // Post initialization error back to the extension host for easier debugging
            this.vscode.postMessage({
                type: 'error',
                error: `Failed to initialize DuckDB: ${error}`
            });
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

        // Format button
        document.getElementById('format-btn')?.addEventListener('click', () => {
            this.sqlEditor.format();
        });

        // Settings modal
        const settingsModal = document.getElementById('settings-modal');
        const maxRowsInput = document.getElementById('max-rows-input') as HTMLInputElement;

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (settingsModal && maxRowsInput) {
                maxRowsInput.value = this.duckdb.maxRows.toString();
                settingsModal.classList.remove('hidden');
            }
        });

        document.getElementById('close-settings-btn')?.addEventListener('click', () => {
            settingsModal?.classList.add('hidden');
        });

        document.getElementById('save-settings-btn')?.addEventListener('click', () => {
            if (maxRowsInput) {
                const newMaxRows = parseInt(maxRowsInput.value, 10);
                if (!isNaN(newMaxRows) && newMaxRows > 0) {
                    this.duckdb.maxRows = newMaxRows;
                }
            }
            settingsModal?.classList.add('hidden');
        });

        // Messages from extension
        window.addEventListener('message', (event) => {
            this.handleExtensionMessage(event.data as Message);
        });

        // Handle window resize for Monaco editor layout
        window.addEventListener('resize', () => {
            this.sqlEditor.layout();
        });

        // Handle preview data from schema explorer
        document.getElementById('schema-explorer')?.addEventListener('previewData', (event) => {
            const customEvent = event as CustomEvent<{ query: string }>;
            const query = customEvent.detail.query;
            this.sqlEditor.setValue(query);
            this.executeQuery();
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

    private setupTabs(): void {
        document.getElementById('add-tab-btn')?.addEventListener('click', () => {
            this.addTab('Query');
        });
        
        // Add default tab
        this.addTab('Query 1', '-- Write your SQL query here\n-- Drop a CSV, Parquet, or JSON file to get started\nSELECT * FROM your_table LIMIT 100;');
    }

    private addTab(title: string, content: string = ''): void {
        const id = 'tab_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        let actualTitle = title;
        if (this.tabs.length > 0) {
            actualTitle = title.startsWith('Query') ? `Query ${this.tabs.length + 1}` : title;
        }
        
        this.tabs.push({ id, title: actualTitle, content, viewState: null });
        this.switchTab(id);
        this.renderTabs();
    }

    private switchTab(id: string): void {
        // Save current tab state
        if (this.activeTabId) {
            const currentTab = this.tabs.find(t => t.id === this.activeTabId);
            if (currentTab) {
                currentTab.content = this.sqlEditor.getValue();
                currentTab.viewState = this.sqlEditor.getViewState();
            }
        }

        this.activeTabId = id;
        const newTab = this.tabs.find(t => t.id === id);
        if (newTab) {
            this.sqlEditor.setValue(newTab.content);
            if (newTab.viewState) {
                this.sqlEditor.restoreViewState(newTab.viewState);
            }
        }
        this.renderTabs();
    }

    private closeTab(id: string): void {
        if (this.tabs.length <= 1) return; // don't close last tab

        const index = this.tabs.findIndex(t => t.id === id);
        if (index > -1) {
            this.tabs.splice(index, 1);
            if (this.activeTabId === id) {
                const nextTab = this.tabs[Math.min(index, this.tabs.length - 1)];
                this.switchTab(nextTab.id);
            } else {
                this.renderTabs();
            }
        }
    }

    private renderTabs(): void {
        const container = document.getElementById('tabs-container');
        if (!container) return;

        container.innerHTML = '';
        this.tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `editor-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
            
            const titleEl = document.createElement('span');
            titleEl.className = 'tab-title';
            titleEl.textContent = tab.title;
            tabEl.appendChild(titleEl);

            if (this.tabs.length > 1) {
                const closeBtn = document.createElement('span');
                closeBtn.className = 'close-tab-btn';
                closeBtn.innerHTML = '×';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(tab.id);
                });
                tabEl.appendChild(closeBtn);
            }

            tabEl.addEventListener('click', () => {
                if (tab.id !== this.activeTabId) {
                    this.switchTab(tab.id);
                }
            });

            container.appendChild(tabEl);
        });
    }

    private addToHistory(sql: string, result: QueryResult): void {
        this.queryHistory.unshift({
            sql,
            timestamp: new Date(),
            result
        });

        // Limit to 20
        if (this.queryHistory.length > 20) {
            this.queryHistory.pop();
        }

        this.renderHistory();
    }

    private renderHistory(): void {
        const container = document.getElementById('query-history-list');
        if (!container) return;

        container.innerHTML = '';
        this.queryHistory.forEach((item, index) => {
            const el = document.createElement('div');
            el.className = 'history-item';
            
            const querySpan = document.createElement('div');
            querySpan.className = 'history-query';
            querySpan.textContent = item.sql.length > 50 ? item.sql.substring(0, 50) + '...' : item.sql;
            
            const metaSpan = document.createElement('div');
            metaSpan.className = 'history-meta';
            metaSpan.innerHTML = `<span>${item.timestamp.toLocaleTimeString()}</span><span>${item.result.totalRows} rows</span>`;
            
            el.appendChild(querySpan);
            el.appendChild(metaSpan);

            el.addEventListener('click', () => {
                this.showHistoryResult(index);
            });

            container.appendChild(el);
        });
    }

    private showHistoryResult(index: number): void {
        const item = this.queryHistory[index];
        if (!item) return;

        this.lastQuerySql = item.sql;
        this.lastQueryResult = item.result;

        const serializedRows = this.serializeRows(item.result.rows);

        this.vscode.postMessage({
            type: 'queryResult',
            columns: item.result.columns,
            rows: serializedRows,
            totalRows: item.result.totalRows,
            executionTime: item.result.executionTime,
            isTruncated: item.result.isTruncated,
        });

        this.setQueryStatus(`Loaded history result: ${item.result.totalRows.toLocaleString()} rows`);
    }

    private async handleExtensionMessage(message: Message): Promise<void> {
        switch (message.type) {
            case 'addFile':
                await this.handleAddFile(message as unknown as AddFileMessage);
                break;
            case 'requestExport':
                // Extension is requesting export (triggered from results panel)
                const exportMessage = message as { type: string; format: 'csv' | 'parquet' };
                await this.exportResults(exportMessage.format);
                break;
            case 'restoreQuery':
                const restoreMessage = message as { type: string; query: string };
                this.sqlEditor.setValue(restoreMessage.query);
                break;
        }
    }

    private async handleAddFile(message: AddFileMessage): Promise<void> {
        try {
            this.setQueryStatus(`Downloading ${message.fileName}...`);
            const response = await fetch(message.webviewUri);
            if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const fileData = new Uint8Array(arrayBuffer);
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
        // Save current tab state before executing
        if (this.activeTabId) {
            const currentTab = this.tabs.find(t => t.id === this.activeTabId);
            if (currentTab) {
                currentTab.content = this.sqlEditor.getValue();
            }
        }

        const sql = this.sqlEditor.getQueryAtCursor().trim();
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
            this.lastQuerySql = sql;

            // Serialize rows to handle BigInt values (DuckDB returns BigInt which can't be JSON serialized)
            const serializedRows = this.serializeRows(result.rows);

            // Send results to extension host (which forwards to bottom panel)
            this.vscode.postMessage({
                type: 'queryResult',
                columns: result.columns,
                rows: serializedRows,
                totalRows: result.totalRows,
                executionTime: result.executionTime,
                isTruncated: result.isTruncated,
            });

            // Save query state
            this.vscode.postMessage({
                type: 'saveQueryState',
                query: this.sqlEditor.getValue(), // save entire editor contents to persist across reloads
            });

            // Update status
            const formattedTime = result.executionTime.toFixed(0);
            this.setQueryStatus(`Query completed: ${result.totalRows.toLocaleString()} rows (${formattedTime}ms)`);
            
            // Add to history
            this.addToHistory(sql, result);

            runBtn.disabled = false;
        } catch (error) {
            const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
            runBtn.disabled = false;
            this.setQueryStatus('Query failed');

            // Send error to extension host (which forwards to bottom panel)
            this.vscode.postMessage({
                type: 'queryError',
                error: String(error),
            });
        }
    }

    private async exportResults(format: 'csv' | 'parquet'): Promise<void> {
        if (!this.lastQuerySql) {
            this.showError('No query to export');
            return;
        }

        try {
            this.setQueryStatus(`Exporting as ${format.toUpperCase()}...`);
            const data = await this.duckdb.exportResults(this.lastQuerySql, format);

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

    /**
     * Serialize row values to handle BigInt (DuckDB returns BigInt which can't be JSON stringified)
     */
    private serializeRows(rows: unknown[][]): unknown[][] {
        return rows.map(row =>
            row.map(cell => {
                if (typeof cell === 'bigint') {
                    // Convert BigInt to Number if safe, otherwise to string
                    if (cell >= Number.MIN_SAFE_INTEGER && cell <= Number.MAX_SAFE_INTEGER) {
                        return Number(cell);
                    }
                    return cell.toString();
                }
                return cell;
            })
        );
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SqlExplorerApp();
});
