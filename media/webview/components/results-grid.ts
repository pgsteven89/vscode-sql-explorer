/**
 * Results Grid Component
 * Virtual scrolling grid for displaying query results
 */

import { QueryResult, Column } from '../duckdb-manager';

export class ResultsGrid {
    private container: HTMLElement;
    private columns: Column[] = [];
    private rows: unknown[][] = [];
    private rowHeight = 32;
    private bufferRows = 10; // Extra rows to render above/below viewport
    private scrollContainer: HTMLElement | null = null;
    private gridBody: HTMLElement | null = null;
    private visibleStart = 0;
    private visibleEnd = 0;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    render(result: QueryResult): void {
        this.columns = result.columns;
        this.rows = result.rows;

        // Reset visible range to force re-render
        this.visibleStart = -1;
        this.visibleEnd = -1;

        this.container.innerHTML = '';

        if (this.rows.length === 0) {
            this.showEmpty('No results');
            return;
        }

        // Create scrollable container
        this.scrollContainer = document.createElement('div');
        this.scrollContainer.style.cssText = `
            width: 100%;
            height: 100%;
            overflow: auto;
            position: relative;
        `;

        // Create header
        const header = this.createHeader();
        this.scrollContainer.appendChild(header);

        // Create body container with placeholder for virtual height
        this.gridBody = document.createElement('div');
        this.gridBody.className = 'grid-body';
        this.gridBody.style.height = `${this.rows.length * this.rowHeight}px`;
        this.gridBody.style.position = 'relative';
        this.scrollContainer.appendChild(this.gridBody);

        // Listen to scroll events
        this.scrollContainer.addEventListener('scroll', () => {
            this.updateVisibleRows();
        });

        this.container.appendChild(this.scrollContainer);

        // Initial render
        this.updateVisibleRows();
    }

    private createHeader(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'grid-header';

        const totalWidth = this.columns.length * 200;
        header.style.width = `${totalWidth}px`;

        for (const column of this.columns) {
            const cell = document.createElement('div');
            cell.className = 'grid-header-cell';
            cell.innerHTML = `
                <span class="column-name">${this.escapeHtml(column.name)}</span>
                <span class="column-type-badge">${column.type}</span>
            `;
            header.appendChild(cell);
        }

        return header;
    }

    private updateVisibleRows(): void {
        if (!this.scrollContainer || !this.gridBody) { return; }

        const scrollTop = this.scrollContainer.scrollTop;
        const viewportHeight = this.scrollContainer.clientHeight;
        const headerHeight = 40; // Approximate header height

        // Calculate visible range
        const firstVisible = Math.max(0, Math.floor((scrollTop - headerHeight) / this.rowHeight) - this.bufferRows);
        const lastVisible = Math.min(
            this.rows.length - 1,
            Math.ceil((scrollTop - headerHeight + viewportHeight) / this.rowHeight) + this.bufferRows
        );

        // Only re-render if range changed significantly
        if (firstVisible === this.visibleStart && lastVisible === this.visibleEnd) {
            return;
        }

        this.visibleStart = firstVisible;
        this.visibleEnd = lastVisible;

        // Clear existing rows
        this.gridBody.innerHTML = '';

        // Render visible rows
        for (let i = firstVisible; i <= lastVisible; i++) {
            const row = this.createRow(i);
            this.gridBody.appendChild(row);
        }
    }

    private createRow(index: number): HTMLElement {
        const rowData = this.rows[index];
        const row = document.createElement('div');
        row.className = `grid-row${index % 2 === 0 ? ' even' : ''}`;

        // Ensure row is wide enough for all columns
        const totalWidth = this.columns.length * 200;

        row.style.cssText = `
            position: absolute;
            top: ${index * this.rowHeight}px;
            width: ${totalWidth}px;
            display: flex;
        `;

        for (let colIndex = 0; colIndex < this.columns.length; colIndex++) {
            const value = rowData[colIndex];
            const column = this.columns[colIndex];
            const cell = document.createElement('div');

            let className = 'grid-cell';
            let displayValue: string;

            if (value === null || value === undefined) {
                className += ' null';
                displayValue = 'NULL';
            } else if (typeof value === 'number' || this.isNumericType(column.type)) {
                className += ' number';
                displayValue = this.formatValue(value, column.type);
            } else {
                displayValue = this.formatValue(value, column.type);
            }

            cell.className = className;
            cell.textContent = displayValue;
            cell.title = displayValue; // Show full value on hover
            row.appendChild(cell);
        }

        return row;
    }

    private isNumericType(type: string): boolean {
        const numericTypes = ['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC', 'REAL'];
        return numericTypes.some(t => type.toUpperCase().includes(t));
    }

    private formatValue(value: unknown, type?: string): string {
        if (value === null || value === undefined) {
            return 'NULL';
        }

        // Handle DuckDB/Arrow specialized types
        const typeUpper = type?.toUpperCase() || '';

        if (typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP')) {
            if (typeof value === 'number') {
                // DuckDB often returns timestamps as epoch millis or micros
                // If it's a huge number, it's likely micros
                const date = new Date(value > 1e12 ? value / 1000 : value);
                return date.toLocaleString();
            }
            if (value instanceof Date) {
                return value.toLocaleString();
            }
        }

        if (typeof value === 'object') {
            if (value instanceof Date) {
                return value.toLocaleString();
            }
            // Handle BigInt from DuckDB
            if (typeof (value as any).toJSON === 'function') {
                return String(value);
            }
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        // For large numbers, add locale formatting
        if (typeof value === 'number' && !typeUpper.includes('DATE') && !typeUpper.includes('TIMESTAMP')) {
            if (Number.isInteger(value)) {
                return value.toLocaleString();
            }
            return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        }

        return String(value);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showEmpty(message: string): void {
        this.container.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon">📊</span>
                <span>${message}</span>
            </div>
        `;
    }

    showError(error: string): void {
        this.container.innerHTML = `
            <div class="query-error">${this.escapeHtml(error)}</div>
        `;
    }

    getRowCount(): number {
        return this.rows.length;
    }
}
