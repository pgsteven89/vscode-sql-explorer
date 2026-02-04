/**
 * SQL Editor Component with Monaco Editor
 * Full-featured SQL editor with syntax highlighting and autocomplete
 */

// Monaco will be loaded via AMD loader from the assets
declare const monaco: typeof import('monaco-editor');
declare const require: {
    config: (config: unknown) => void;
    (deps: string[], callback: (...args: unknown[]) => void): void;
};

export interface TableInfo {
    name: string;
    columns: Array<{ name: string; type: string }>;
}

export class SqlEditor {
    private container: HTMLElement;
    private editor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;
    private onExecute: () => void;
    private isMonacoLoaded = false;
    private pendingValue: string = '';
    private tableInfo: TableInfo[] = [];
    private monacoUri: string;

    constructor(container: HTMLElement, onExecute: () => void, monacoUri: string) {
        this.container = container;
        this.onExecute = onExecute;
        this.monacoUri = monacoUri;
        this.initializeMonaco();
    }

    private async initializeMonaco(): Promise<void> {
        // Create a temporary textarea while Monaco loads
        this.createFallbackEditor();

        try {
            await this.loadMonaco();
            this.createMonacoEditor();
        } catch (error) {
            console.warn('Failed to load Monaco, using fallback editor:', error);
            // Keep using fallback editor
        }
    }

    private createFallbackEditor(): void {
        const textarea = document.createElement('textarea');
        textarea.id = 'sql-fallback-editor';
        textarea.placeholder = 'Loading SQL editor...';
        textarea.spellcheck = false;
        textarea.style.cssText = `
            width: 100%;
            height: 100%;
            padding: 12px;
            border: none;
            outline: none;
            resize: none;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
            font-size: var(--vscode-editor-font-size, 14px);
            line-height: 1.5;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            tab-size: 4;
        `;

        textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.onExecute();
            }
        });

        this.container.appendChild(textarea);
    }

    private loadMonaco(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check if Monaco is already loaded
            if (typeof monaco !== 'undefined') {
                resolve();
                return;
            }

            // Load Monaco AMD loader
            const loaderScript = document.createElement('script');
            loaderScript.src = `${this.monacoUri}/vs/loader.js`;
            loaderScript.onload = () => {
                // Configure AMD loader
                require.config({
                    paths: {
                        'vs': `${this.monacoUri}/vs`
                    }
                });

                // Load Monaco editor
                require(['vs/editor/editor.main'], () => {
                    this.isMonacoLoaded = true;
                    resolve();
                });
            };
            loaderScript.onerror = () => {
                reject(new Error('Failed to load Monaco loader'));
            };

            document.head.appendChild(loaderScript);
        });
    }

    private createMonacoEditor(): void {
        // Remove fallback editor
        const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
        const currentValue = fallback?.value || this.pendingValue;
        this.container.innerHTML = '';

        // Create editor container
        const editorContainer = document.createElement('div');
        editorContainer.style.cssText = 'width: 100%; height: 100%;';
        this.container.appendChild(editorContainer);

        // Get VSCode theme info
        const isDark = document.body.classList.contains('vscode-dark') ||
            getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#1') ||
            getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#2');

        // Define custom SQL theme that matches VSCode
        monaco.editor.defineTheme('sql-explorer-theme', {
            base: isDark ? 'vs-dark' : 'vs',
            inherit: true,
            rules: [
                { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' },
                { token: 'keyword.sql', foreground: '569cd6', fontStyle: 'bold' },
                { token: 'string', foreground: 'ce9178' },
                { token: 'string.sql', foreground: 'ce9178' },
                { token: 'number', foreground: 'b5cea8' },
                { token: 'comment', foreground: '6a9955' },
                { token: 'operator', foreground: 'd4d4d4' },
                { token: 'identifier', foreground: '9cdcfe' },
            ],
            colors: {
                'editor.background': getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim() || (isDark ? '#1e1e1e' : '#ffffff'),
                'editor.foreground': getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || (isDark ? '#d4d4d4' : '#000000'),
            }
        });

        // Create editor
        this.editor = monaco.editor.create(editorContainer, {
            value: currentValue || '-- Write your SQL query here\nSELECT * FROM your_table LIMIT 100;',
            language: 'sql',
            theme: 'sql-explorer-theme',
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "Consolas, 'Courier New', monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            folding: true,
            renderLineHighlight: 'line',
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
            },
        });

        // Add Ctrl+Enter command
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            this.onExecute();
        });

        // Register completion provider
        this.registerCompletionProvider();
    }

    private registerCompletionProvider(): void {
        monaco.languages.registerCompletionItemProvider('sql', {
            provideCompletionItems: (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                };

                const suggestions: import('monaco-editor').languages.CompletionItem[] = [];

                // SQL keywords
                const keywords = [
                    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
                    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON',
                    'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
                    'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
                    'AS', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT',
                    'WITH', 'RECURSIVE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                    'NULL', 'IS', 'TRUE', 'FALSE', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
                    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST',
                ];

                keywords.forEach(kw => {
                    suggestions.push({
                        label: kw,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: kw,
                        range: range,
                    });
                });

                // Add table names
                this.tableInfo.forEach(table => {
                    suggestions.push({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: `"${table.name}"`,
                        detail: 'Table',
                        range: range,
                    });

                    // Add column names with table prefix
                    table.columns.forEach(col => {
                        suggestions.push({
                            label: `${table.name}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: `"${table.name}"."${col.name}"`,
                            detail: col.type,
                            range: range,
                        });

                        // Also add just column name
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: `"${col.name}"`,
                            detail: `${col.type} (${table.name})`,
                            range: range,
                        });
                    });
                });

                return { suggestions };
            }
        });
    }

    updateTableInfo(tables: TableInfo[]): void {
        this.tableInfo = tables;
    }

    getValue(): string {
        if (this.editor) {
            return this.editor.getValue();
        }
        const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
        return fallback?.value || '';
    }

    setValue(value: string): void {
        if (this.editor) {
            this.editor.setValue(value);
        } else {
            this.pendingValue = value;
            const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
            if (fallback) {
                fallback.value = value;
            }
        }
    }

    insertText(text: string): void {
        if (this.editor) {
            const selection = this.editor.getSelection();
            if (selection) {
                this.editor.executeEdits('insert', [{
                    range: selection,
                    text: text,
                }]);
            }
            this.editor.focus();
        } else {
            const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
            if (fallback) {
                const start = fallback.selectionStart;
                const end = fallback.selectionEnd;
                fallback.value = fallback.value.substring(0, start) + text + fallback.value.substring(end);
                fallback.selectionStart = fallback.selectionEnd = start + text.length;
                fallback.focus();
            }
        }
    }

    focus(): void {
        if (this.editor) {
            this.editor.focus();
        } else {
            const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
            fallback?.focus();
        }
    }

    getSelectedText(): string {
        if (this.editor) {
            const selection = this.editor.getSelection();
            if (selection) {
                return this.editor.getModel()?.getValueInRange(selection) || '';
            }
        }
        const fallback = this.container.querySelector('#sql-fallback-editor') as HTMLTextAreaElement;
        if (fallback) {
            return fallback.value.substring(fallback.selectionStart, fallback.selectionEnd);
        }
        return '';
    }

    layout(): void {
        if (this.editor) {
            this.editor.layout();
        }
    }
}
