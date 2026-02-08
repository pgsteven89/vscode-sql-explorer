/**
 * Results Panel Script
 * Handles rendering query results in the bottom panel webview
 */

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    // State
    let currentResults = null;
    let columns = [];
    let rows = [];
    let columnWidths = [];

    // DOM Elements
    const resultsInfo = document.getElementById('results-info');
    const resultsGrid = document.getElementById('results-grid');
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const downloadParquetBtn = document.getElementById('download-parquet-btn');

    // Virtual scrolling settings
    const ROW_HEIGHT = 32;
    const BUFFER_ROWS = 10;

    /**
     * Initialize event listeners
     */
    function init() {
        // Handle messages from extension
        window.addEventListener('message', handleMessage);

        // Download buttons
        downloadCsvBtn?.addEventListener('click', () => requestDownload('csv'));
        downloadParquetBtn?.addEventListener('click', () => requestDownload('parquet'));

        // Notify extension we're ready
        vscode.postMessage({ type: 'ready' });
    }

    /**
     * Handle incoming messages from the extension
     */
    function handleMessage(event) {
        const message = event.data;

        switch (message.type) {
            case 'showResults':
                renderResults(message.data);
                break;
            case 'showError':
                showError(message.error);
                break;
            case 'showStatus':
                updateStatus(message.status);
                break;
        }
    }

    /**
     * Render query results
     */
    function renderResults(data) {
        currentResults = data;
        columns = data.columns || [];
        rows = data.rows || [];

        if (rows.length === 0) {
            showEmpty('Query returned no results');
            setDownloadEnabled(false);
            return;
        }

        // Calculate column widths
        columnWidths = calculateColumnWidths();

        // Update info
        const timeStr = data.executionTime ? ` (${data.executionTime.toFixed(0)}ms)` : '';
        const truncatedStr = data.isTruncated ? ' (truncated)' : '';
        resultsInfo.textContent = `${data.totalRows.toLocaleString()} rows${truncatedStr}${timeStr}`;

        // Enable downloads
        setDownloadEnabled(true);

        // Render with virtual scrolling for large datasets
        if (rows.length > 100) {
            renderVirtualScrollTable();
        } else {
            renderStaticTable();
        }
    }

    /**
     * Render a static table for small datasets
     */
    function renderStaticTable() {
        const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 60; // +60 for row numbers

        let html = `<div class="results-table-wrapper" style="min-width: ${totalWidth}px">`;
        html += '<table class="results-table">';

        // Header
        html += '<thead><tr>';
        html += '<th class="row-number">#</th>';
        columns.forEach((col, i) => {
            html += `<th data-col-index="${i}" style="width: ${columnWidths[i]}px; min-width: 50px; position: relative;">
                <div class="column-header">
                    <span class="column-name">${escapeHtml(col.name)}</span>
                    <span class="column-type">${escapeHtml(col.type)}</span>
                </div>
                <div class="column-resizer" data-col-index="${i}"></div>
            </th>`;
        });
        html += '</tr></thead>';

        // Body
        html += '<tbody>';
        rows.forEach((row, rowIndex) => {
            html += '<tr>';
            html += `<td class="row-number">${rowIndex + 1}</td>`;
            row.forEach((cell, colIndex) => {
                const col = columns[colIndex];
                const isNumeric = isNumericType(col?.type);
                const isNull = cell === null || cell === undefined;
                const classes = [];
                if (isNumeric) classes.push('numeric');
                if (isNull) classes.push('null-value');

                const value = isNull ? 'NULL' : formatValue(cell, col?.type);
                html += `<td data-col-index="${colIndex}" class="${classes.join(' ')}" style="width: ${columnWidths[colIndex]}px">${escapeHtml(value)}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        resultsGrid.innerHTML = html;

        // Setup column resizers
        setupColumnResizers();
    }

    /**
     * Render with virtual scrolling for large datasets
     */
    function renderVirtualScrollTable() {
        const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 60;
        const totalHeight = rows.length * ROW_HEIGHT;

        // Create header
        let headerHtml = '<div class="virtual-header" style="position: sticky; top: 0; z-index: 10; background: var(--vscode-editorWidget-background);">';
        headerHtml += '<div class="virtual-row" style="display: flex; border-bottom: 2px solid var(--vscode-panel-border);">';
        headerHtml += `<div class="virtual-cell row-number" style="width: 60px; min-width: 60px;">#</div>`;
        columns.forEach((col, i) => {
            headerHtml += `<div class="virtual-cell" style="width: ${columnWidths[i]}px; min-width: ${columnWidths[i]}px; font-weight: 600;">
                <div class="column-header">
                    <span class="column-name">${escapeHtml(col.name)}</span>
                    <span class="column-type" style="font-size: 10px; color: var(--vscode-descriptionForeground);">${escapeHtml(col.type)}</span>
                </div>
            </div>`;
        });
        headerHtml += '</div></div>';

        // Create virtual scroll container
        resultsGrid.innerHTML = `
            ${headerHtml}
            <div class="virtual-scroll-container" style="min-width: ${totalWidth}px">
                <div class="virtual-scroll-content" style="height: ${totalHeight}px;">
                    <div class="virtual-rows"></div>
                </div>
            </div>
        `;

        const scrollContainer = resultsGrid.querySelector('.virtual-scroll-container');
        const virtualRows = resultsGrid.querySelector('.virtual-rows');

        // Update visible rows on scroll
        scrollContainer.addEventListener('scroll', () => updateVisibleRows(scrollContainer, virtualRows));

        // Initial render
        updateVisibleRows(scrollContainer, virtualRows);
    }

    /**
     * Update visible rows for virtual scrolling
     */
    function updateVisibleRows(scrollContainer, virtualRows) {
        const scrollTop = scrollContainer.scrollTop;
        const containerHeight = scrollContainer.clientHeight;

        const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
        const endIndex = Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);

        let html = '';
        for (let i = startIndex; i < endIndex; i++) {
            const row = rows[i];
            const top = i * ROW_HEIGHT;

            html += `<div class="virtual-row" style="top: ${top}px; height: ${ROW_HEIGHT}px;">`;
            html += `<div class="virtual-cell row-number" style="width: 60px; min-width: 60px;">${i + 1}</div>`;
            row.forEach((cell, colIndex) => {
                const col = columns[colIndex];
                const isNumeric = isNumericType(col?.type);
                const isNull = cell === null || cell === undefined;
                const value = isNull ? 'NULL' : formatValue(cell, col?.type);
                const style = `width: ${columnWidths[colIndex]}px; min-width: ${columnWidths[colIndex]}px;` +
                    (isNumeric ? ' text-align: right; font-family: monospace;' : '') +
                    (isNull ? ' color: var(--vscode-descriptionForeground); font-style: italic;' : '');
                html += `<div class="virtual-cell" style="${style}">${escapeHtml(value)}</div>`;
            });
            html += '</div>';
        }

        virtualRows.innerHTML = html;
    }

    /**
     * Calculate optimal column widths
     */
    function calculateColumnWidths() {
        const MIN_WIDTH = 20;
        const MAX_WIDTH = 300;
        const CHAR_WIDTH = 8;
        const PADDING = 24;

        return columns.map((col, colIndex) => {
            // Start with header width
            let maxWidth = (col.name.length + col.type.length / 2) * CHAR_WIDTH + PADDING;

            // Sample first 100 rows for content width
            const sampleRows = rows.slice(0, 100);
            for (const row of sampleRows) {
                const value = formatValue(row[colIndex], col.type);
                const width = value.length * CHAR_WIDTH + PADDING;
                maxWidth = Math.max(maxWidth, width);
            }

            return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, maxWidth));
        });
    }

    /**
     * Format a cell value for display
     */
    function formatValue(value, type) {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'object') return JSON.stringify(value);
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return value.toString();
            return value.toFixed(4);
        }
        return String(value);
    }

    /**
     * Check if a column type is numeric
     */
    function isNumericType(type) {
        if (!type) return false;
        const t = type.toLowerCase();
        return t.includes('int') || t.includes('float') || t.includes('double') ||
            t.includes('decimal') || t.includes('numeric') || t.includes('real');
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        const str = String(text);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Show empty state
     */
    function showEmpty(message) {
        resultsGrid.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📊</span>
                <span>${escapeHtml(message)}</span>
            </div>
        `;
    }

    /**
     * Show error state
     */
    function showError(error) {
        resultsGrid.innerHTML = `
            <div class="error-state">
                <strong>Error:</strong> ${escapeHtml(error)}
            </div>
        `;
        resultsInfo.textContent = 'Query failed';
        setDownloadEnabled(false);
    }

    /**
     * Update status text
     */
    function updateStatus(status) {
        resultsInfo.textContent = status;
    }

    /**
     * Enable/disable download buttons
     */
    function setDownloadEnabled(enabled) {
        if (downloadCsvBtn) downloadCsvBtn.disabled = !enabled;
        if (downloadParquetBtn) downloadParquetBtn.disabled = !enabled;
    }

    /**
     * Setup column resizer drag handlers
     */
    function setupColumnResizers() {
        const resizers = resultsGrid.querySelectorAll('.column-resizer');

        resizers.forEach(resizer => {
            let startX = 0;
            let startWidth = 0;
            let colIndex = parseInt(resizer.dataset.colIndex, 10);

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.pageX;
                startWidth = columnWidths[colIndex];

                resizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            function onMouseMove(e) {
                const diff = e.pageX - startX;
                const newWidth = Math.max(20, Math.min(600, startWidth + diff));
                columnWidths[colIndex] = newWidth;

                // Update header cell width
                const headerCell = resultsGrid.querySelector(`th[data-col-index="${colIndex}"]`);
                if (headerCell) {
                    headerCell.style.width = newWidth + 'px';
                }

                // Update all cells in this column
                const bodyCells = resultsGrid.querySelectorAll(`td[data-col-index="${colIndex}"]`);
                bodyCells.forEach(cell => {
                    cell.style.width = newWidth + 'px';
                });
            }

            function onMouseUp() {
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        });
    }

    /**
     * Request file download from extension
     */
    function requestDownload(format) {
        vscode.postMessage({
            type: 'downloadResults',
            format: format
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
