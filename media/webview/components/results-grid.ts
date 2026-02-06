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
    private columnWidths: number[] = [];
    private dragStartIndex = -1;
    private dragStartX = 0;
    private dragStartWidth = 0;

    constructor(container: HTMLElement) {
        this.container = container;

        // Bind drag events
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
    }

    render(result: QueryResult): void {
        this.columns = result.columns;
        this.rows = result.rows;

        // Auto-size column widths based on content
        this.columnWidths = this.calculateColumnWidths();

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

        this.updateTotalWidth(header);

        this.columns.forEach((column, index) => {
            const cell = document.createElement('div');
            cell.className = 'grid-header-cell';
            cell.style.width = `${this.columnWidths[index]}px`;
            cell.style.flex = `0 0 ${this.columnWidths[index]}px`;
            cell.dataset.colIndex = String(index);

            cell.innerHTML = `
                <span class="column-name">${this.escapeHtml(column.name)}</span>
                <span class="column-type-badge">${column.type}</span>
            `;

            // Add resizer
            const resizer = document.createElement('div');
            resizer.className = 'column-resizer';
            resizer.addEventListener('mousedown', (e) => this.handleMouseDown(e, index));
            // Prevent event bubbling to avoid sorting if we implement it later
            resizer.addEventListener('click', (e) => e.stopPropagation());

            cell.appendChild(resizer);
            header.appendChild(cell);
        });

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

        this.updateTotalWidth(row);

        row.style.position = 'absolute';
        row.style.top = `${index * this.rowHeight}px`;

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
            cell.title = displayValue;

            // Set dynamic width
            const width = this.columnWidths[colIndex];
            cell.style.width = `${width}px`;
            cell.style.flex = `0 0 ${width}px`;

            row.appendChild(cell);
        }

        return row;
    }

    private handleMouseDown(e: MouseEvent, index: number): void {
        e.preventDefault();
        e.stopPropagation();

        this.dragStartIndex = index;
        this.dragStartX = e.clientX;
        this.dragStartWidth = this.columnWidths[index];

        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);

        // Add resizing class to the specific resizer for visual feedback
        const resizer = (e.target as HTMLElement);
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
    }

    private handleMouseMove(e: MouseEvent): void {
        if (this.dragStartIndex === -1) return;

        const deltaX = e.clientX - this.dragStartX;
        const newWidth = Math.max(50, this.dragStartWidth + deltaX);

        this.columnWidths[this.dragStartIndex] = newWidth;

        // Efficiently update DOM
        this.updateColumnWidth(this.dragStartIndex, newWidth);
    }

    private handleMouseUp(): void {
        this.dragStartIndex = -1;
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.body.style.cursor = '';

        // Remove resizing class from all resizers
        const resizers = this.container.querySelectorAll('.column-resizer.resizing');
        resizers.forEach(r => r.classList.remove('resizing'));
    }

    private updateColumnWidth(index: number, width: number): void {
        // Update header cell
        const headerCell = this.container.querySelector(`.grid-header-cell[data-col-index="${index}"]`) as HTMLElement;
        if (headerCell) {
            headerCell.style.width = `${width}px`;
            headerCell.style.flex = `0 0 ${width}px`;
        }

        // Update all visible row cells for this column
        // Note: querySelectorAll is fast enough for visible rows (~50)
        // Since we don't have unique IDs on cells, we iterate rows
        if (this.gridBody) {
            const rows = this.gridBody.children;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] as HTMLElement;
                const cell = row.children[index] as HTMLElement;
                if (cell) {
                    cell.style.width = `${width}px`;
                    cell.style.flex = `0 0 ${width}px`;
                }
                this.updateTotalWidth(row);
            }
        }

        // Update header total width
        const header = this.container.querySelector('.grid-header') as HTMLElement;
        if (header) {
            this.updateTotalWidth(header);
        }
    }

    private updateTotalWidth(element: HTMLElement): void {
        const totalWidth = this.columnWidths.reduce((sum, w) => sum + w, 0);
        element.style.width = `${totalWidth}px`;
    }

    private calculateColumnWidths(): number[] {
        const MIN_WIDTH = 50;
        const MAX_WIDTH = 300;
        const PADDING = 32; // Account for cell padding and resizer
        const HEADER_EXTRA_PADDING = 60; // Extra space for type badge

        // Create a hidden canvas context to measure text
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            // Fallback to default widths if canvas isn't available
            return this.columns.map(() => 150);
        }

        // Use the same font as the grid cells
        ctx.font = '13px var(--vscode-editor-font-family, monospace)';

        return this.columns.map((column, colIndex) => {
            // Measure header text (column name + type badge)
            const headerWidth = ctx.measureText(column.name).width + HEADER_EXTRA_PADDING;

            // Sample data rows to find max content width
            // Only sample first 100 rows for performance
            const sampleSize = Math.min(100, this.rows.length);
            let maxDataWidth = 0;

            for (let i = 0; i < sampleSize; i++) {
                const value = this.rows[i][colIndex];
                const displayValue = this.formatValue(value, column.type);
                const textWidth = ctx.measureText(displayValue).width + PADDING;
                maxDataWidth = Math.max(maxDataWidth, textWidth);
            }

            // Use the larger of header width or data width
            const optimalWidth = Math.max(headerWidth, maxDataWidth);

            // Clamp to min/max bounds
            return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, optimalWidth));
        });
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
