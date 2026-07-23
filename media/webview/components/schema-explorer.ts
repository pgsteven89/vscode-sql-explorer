/**
 * Schema Explorer Component
 * Displays loaded tables and their columns
 */

import { TableSchema } from '../duckdb-manager';

export class SchemaExplorer {
    private container: HTMLElement;
    private onInsertText: (text: string) => void;
    private schemas: TableSchema[] = [];
    private expandedTables: Set<string> = new Set();
    private contextMenu: HTMLElement | null = null;

    constructor(container: HTMLElement, onInsertText: (text: string) => void) {
        this.container = container;
        this.onInsertText = onInsertText;
        
        // Dismiss context menu when clicking anywhere
        document.addEventListener('click', () => this.hideContextMenu());
    }

    update(schemas: TableSchema[]): void {
        this.schemas = schemas;
        this.render();
    }

    private render(): void {
        this.container.innerHTML = '';

        if (this.schemas.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state" style="padding: 20px;">
                    <span style="opacity: 0.5;">No tables loaded</span>
                </div>
            `;
            return;
        }

        for (const schema of this.schemas) {
            const tableElement = this.createTableElement(schema);
            this.container.appendChild(tableElement);
        }
    }

    private createTableElement(schema: TableSchema): HTMLElement {
        const tableItem = document.createElement('div');
        tableItem.className = 'table-item';
        if (this.expandedTables.has(schema.name)) {
            tableItem.classList.add('expanded');
        }

        // Table header
        const header = document.createElement('div');
        header.className = 'table-header';
        header.innerHTML = `
            <span class="table-icon">📋</span>
            <span class="table-name" title="${schema.name}">${schema.name}</span>
            <span class="table-row-count">${this.formatRowCount(schema.rowCount)}</span>
            <button class="remove-table-btn" title="Remove table">×</button>
        `;

        // Toggle expand/collapse on header click
        header.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('remove-table-btn')) {
                return; // Don't toggle when clicking remove
            }

            if (this.expandedTables.has(schema.name)) {
                this.expandedTables.delete(schema.name);
                tableItem.classList.remove('expanded');
            } else {
                this.expandedTables.add(schema.name);
                tableItem.classList.add('expanded');
            }
        });

        // Double-click to insert table name
        header.addEventListener('dblclick', () => {
            this.onInsertText(`"${schema.name}"`);
        });

        // Remove button handler
        const removeBtn = header.querySelector('.remove-table-btn') as HTMLElement;
        removeBtn.addEventListener('click', () => {
            this.removeTable(schema.name);
        });

        // Context menu for table
        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e.pageX, e.pageY, `SELECT * FROM "${schema.name}" LIMIT 10;`);
        });

        tableItem.appendChild(header);

        // Columns list
        const columnsDiv = document.createElement('div');
        columnsDiv.className = 'table-columns';

        for (const column of schema.columns) {
            const columnItem = document.createElement('div');
            columnItem.className = 'column-item';
            columnItem.innerHTML = `
                <span class="column-name">${column.name}</span>
                <span class="column-type">${column.type}</span>
            `;

            // Click to insert column name
            columnItem.addEventListener('click', () => {
                this.onInsertText(`"${column.name}"`);
            });

            // Double-click to insert table.column
            columnItem.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.onInsertText(`"${schema.name}"."${column.name}"`);
            });

            // Context menu for column
            columnItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e.pageX, e.pageY, `SELECT "${column.name}" FROM "${schema.name}" LIMIT 10;`);
            });

            columnsDiv.appendChild(columnItem);
        }

        tableItem.appendChild(columnsDiv);

        return tableItem;
    }

    private formatRowCount(count: number): string {
        if (count >= 1000000) {
            return `${(count / 1000000).toFixed(1)}M rows`;
        }
        if (count >= 1000) {
            return `${(count / 1000).toFixed(1)}K rows`;
        }
        return `${count} rows`;
    }

    private showContextMenu(x: number, y: number, query: string): void {
        this.hideContextMenu();

        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'context-menu';
        
        // Ensure menu stays within window bounds
        const maxLeft = window.innerWidth - 160; // Approximate menu width
        const maxTop = window.innerHeight - 50;  // Approximate menu height
        this.contextMenu.style.left = `${Math.min(x, maxLeft)}px`;
        this.contextMenu.style.top = `${Math.min(y, maxTop)}px`;

        const previewItem = document.createElement('div');
        previewItem.className = 'context-menu-item';
        previewItem.textContent = 'Preview Data (Limit 10)';
        previewItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const event = new CustomEvent('previewData', { detail: { query } });
            this.container.dispatchEvent(event);
            this.hideContextMenu();
        });

        this.contextMenu.appendChild(previewItem);
        document.body.appendChild(this.contextMenu);
    }

    private hideContextMenu(): void {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }

    private async removeTable(tableName: string): Promise<void> {
        // Dispatch event for removal (will be handled by main app)
        const event = new CustomEvent('removeTable', { detail: { tableName } });
        this.container.dispatchEvent(event);

        // Remove from local state and re-render
        this.schemas = this.schemas.filter(s => s.name !== tableName);
        this.expandedTables.delete(tableName);
        this.render();
    }
}
