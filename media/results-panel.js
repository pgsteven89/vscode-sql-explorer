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
    let originalRows = [];
    let columnWidths = [];
    let globalSearchQuery = '';
    let columnSearchQueries = {};
    let hiddenColumns = new Set();

    // DOM Elements
    const resultsInfo = document.getElementById('results-info');
    const resultsGrid = document.getElementById('results-grid');
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const downloadParquetBtn = document.getElementById('download-parquet-btn');
    const globalSearchInput = document.getElementById('global-search');

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

        // Search input
        globalSearchInput?.addEventListener('input', (e) => {
            globalSearchQuery = e.target.value;
            filterRows();
        });

        // Show all columns button
        const showAllBtn = document.getElementById('show-all-columns-btn');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                hiddenColumns.clear();
                filterRows();
                updateShowAllButton();
            });
        }

        // Notify extension we're ready
        vscode.postMessage({ type: 'ready' });
    }

    function updateShowAllButton() {
        const btn = document.getElementById('show-all-columns-btn');
        if (btn) {
            btn.style.display = hiddenColumns.size > 0 ? 'inline-block' : 'none';
        }
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
        originalRows = data.rows || [];
        
        // Reset column searches on new query
        columnSearchQueries = {};
        
        if (globalSearchInput) {
            globalSearchInput.disabled = false;
        }

        if (originalRows.length === 0) {
            rows = [];
            showEmpty('Query returned no results');
            setDownloadEnabled(false);
            if (globalSearchInput) globalSearchInput.disabled = true;
            return;
        }

        // Calculate column widths based on original rows
        columnWidths = calculateColumnWidths(originalRows);

        // Enable downloads
        setDownloadEnabled(true);

        filterRows();
    }
    
    function filterRows() {
        if (!globalSearchQuery && Object.keys(columnSearchQueries).length === 0) {
            rows = originalRows;
        } else {
            const globalLower = globalSearchQuery.toLowerCase();
            rows = originalRows.filter(row => {
                // Check column filters
                for (const colIndexStr in columnSearchQueries) {
                    const colIndex = parseInt(colIndexStr, 10);
                    const colQuery = columnSearchQueries[colIndex];
                    if (!colQuery) continue;
                    
                    const cellValue = formatValue(row[colIndex], columns[colIndex]?.type).toLowerCase();
                    if (!cellValue.includes(colQuery)) {
                        return false;
                    }
                }
                
                // Check global filter
                if (globalLower) {
                    let matchGlobal = false;
                    for (let i = 0; i < row.length; i++) {
                        const cellValue = formatValue(row[i], columns[i]?.type).toLowerCase();
                        if (cellValue.includes(globalLower)) {
                            matchGlobal = true;
                            break;
                        }
                    }
                    if (!matchGlobal) return false;
                }
                
                return true;
            });
        }
        
        // Update info
        const timeStr = currentResults.executionTime ? ` (${currentResults.executionTime.toFixed(0)}ms)` : '';
        const truncatedStr = currentResults.isTruncated ? ' (truncated)' : '';
        const filteredStr = rows.length !== originalRows.length ? ` (filtered from ${originalRows.length.toLocaleString()})` : '';
        resultsInfo.textContent = `${rows.length.toLocaleString()} rows${filteredStr}${truncatedStr}${timeStr}`;

        if (rows.length === 0) {
            showEmpty('No results match the current filters');
            return;
        }

        // Render with virtual scrolling for large datasets
        if (rows.length > 100) {
            renderVirtualScrollTable();
        } else {
            renderStaticTable();
        }
        
        bindColumnSearchInputs();
    }
    
    function bindColumnSearchInputs() {
        const inputs = resultsGrid.querySelectorAll('.column-search-input');
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const colIndex = e.target.dataset.colIndex;
                columnSearchQueries[colIndex] = e.target.value.toLowerCase();
                
                const focusedCol = colIndex;
                filterRows();
                
                // Restore focus after re-render
                const newInput = resultsGrid.querySelector(`.column-search-input[data-col-index="${focusedCol}"]`);
                if (newInput) {
                    newInput.focus();
                    const val = newInput.value;
                    newInput.value = '';
                    newInput.value = val;
                }
            });
            input.addEventListener('mousedown', e => e.stopPropagation());
        });

        const hideBtns = resultsGrid.querySelectorAll('.hide-column-btn');
        hideBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const colIndex = parseInt(e.target.dataset.colIndex, 10);
                hiddenColumns.add(colIndex);
                filterRows();
                updateShowAllButton();
            });
        });
    }

    /**
     * Render a static table for small datasets
     */
    function renderStaticTable() {
        resultsGrid.onscroll = null;
        const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + 60; // +60 for row numbers

        let html = `<div class="results-table-wrapper" style="min-width: ${totalWidth}px">`;
        html += '<table class="results-table">';

        // Header
        html += '<thead><tr>';
        html += '<th class="row-number">#</th>';
        columns.forEach((col, i) => {
            if (hiddenColumns.has(i)) return;
            const searchVal = columnSearchQueries[i] || '';
            html += `<th data-col-index="${i}" style="width: ${columnWidths[i]}px; min-width: 50px; position: relative;">
                <div class="column-header">
                    <div class="column-title-row">
                        <span class="column-name" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
                        <span class="column-type">${escapeHtml(col.type)}</span>
                        <button class="hide-column-btn" data-col-index="${i}" title="Hide column">✕</button>
                    </div>
                    <div class="column-filter-row">
                        <input type="text" class="column-search-input" data-col-index="${i}" value="${escapeHtml(searchVal)}" placeholder="Filter..." />
                    </div>
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
                if (hiddenColumns.has(colIndex)) return;
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
        headerHtml += '<div class="virtual-row" style="position: relative; display: flex; border-bottom: 2px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background);">';
        headerHtml += `<div class="virtual-cell row-number" style="width: 60px; min-width: 60px;">#</div>`;
        columns.forEach((col, i) => {
            if (hiddenColumns.has(i)) return;
            const searchVal = columnSearchQueries[i] || '';
            headerHtml += `<div class="virtual-cell" style="width: ${columnWidths[i]}px; min-width: ${columnWidths[i]}px; font-weight: 600;">
                <div class="column-header">
                    <div class="column-title-row">
                        <span class="column-name" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
                        <span class="column-type" style="font-size: 10px; color: var(--vscode-descriptionForeground);">${escapeHtml(col.type)}</span>
                        <button class="hide-column-btn" data-col-index="${i}" title="Hide column">✕</button>
                    </div>
                    <div class="column-filter-row">
                        <input type="text" class="column-search-input" data-col-index="${i}" value="${escapeHtml(searchVal)}" placeholder="Filter..." />
                    </div>
                </div>
            </div>`;
        });
        headerHtml += '</div></div>';

        // Create virtual scroll container
        resultsGrid.innerHTML = `
            <div class="virtual-scroll-container" style="min-width: ${totalWidth}px; height: auto; overflow: visible;">
                ${headerHtml}
                <div class="virtual-scroll-content" style="height: ${totalHeight}px;">
                    <div class="virtual-rows"></div>
                </div>
            </div>
        `;

        const virtualRows = resultsGrid.querySelector('.virtual-rows');

        // Update visible rows on scroll using the main grid
        resultsGrid.onscroll = () => updateVisibleRows(resultsGrid, virtualRows);

        // Initial render
        updateVisibleRows(resultsGrid, virtualRows);
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
                if (hiddenColumns.has(colIndex)) return;
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
    function calculateColumnWidths(dataRows) {
        const MIN_WIDTH = 60;
        const MAX_WIDTH = 300;
        const CHAR_WIDTH = 8;
        const PADDING = 24;

        return columns.map((col, colIndex) => {
            // Start with header width
            let maxWidth = (col.name.length + col.type.length / 2) * CHAR_WIDTH + PADDING;

            // Sample first 100 rows for content width
            const sampleRows = dataRows.slice(0, 100);
            for (const row of sampleRows) {
                const value = formatValue(row[colIndex], col.type);
                const width = value.length * CHAR_WIDTH + PADDING;
                maxWidth = Math.max(maxWidth, width);
            }

            return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, maxWidth));
        });
    }

    /**
     * Check if a column type is a date or time type
     */
    function isDateType(type) {
        if (!type) return false;
        const t = type.toLowerCase();
        return t.includes('date') || t.includes('time') || t.includes('timestamp');
    }

    /**
     * Format a cell value for display
     */
    function formatValue(value, type) {
        if (value === null || value === undefined) return 'NULL';
        
        if (isDateType(type)) {
            try {
                if (typeof value === 'number' || typeof value === 'bigint') {
                    let numValue = Number(value);
                    const t = type.toLowerCase();

                    // Handle TIME type (usually microseconds since midnight)
                    if (t.includes('time') && !t.includes('timestamp')) {
                        let timeMs = Math.floor(numValue / 1000); // DuckDB TIME is often microseconds
                        // If it's already in ms (e.g. less than 86,400,000)
                        if (numValue < 86400000) timeMs = numValue;
                        
                        const hours = Math.floor(timeMs / 3600000);
                        timeMs %= 3600000;
                        const minutes = Math.floor(timeMs / 60000);
                        timeMs %= 60000;
                        const seconds = Math.floor(timeMs / 1000);
                        const msStr = (timeMs % 1000).toString().padStart(3, '0');
                        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${msStr}`;
                    }

                    // Handle DATE and TIMESTAMP types
                    let ms = numValue;
                    if (t.includes('date') && !t.includes('timestamp') && ms < 10000000) {
                        // DuckDB DATE is usually days since epoch
                        ms = ms * 24 * 60 * 60 * 1000;
                    } else if (ms > 1e16 || ms < -1e16) { 
                        // Nanoseconds
                        ms = Math.floor(ms / 1000000);
                    } else if (ms > 1e14 || ms < -1e14) { 
                        // Microseconds (DuckDB native TIMESTAMP is microseconds)
                        ms = Math.floor(ms / 1000);
                    } else if (ms < 1e11 && ms > 1e8) {
                        // For non-timestamps or extremely small timestamps, it could be seconds, but
                        // usually we just treat it as milliseconds if it doesn't clearly match seconds.
                        // Let's assume standard JS milliseconds if it's smaller, 
                        // unless it looks exactly like recent seconds (1e9 to 3e9).
                        if (ms > 1e9 && ms < 3e9) {
                            ms = ms * 1000; // Seconds (e.g. 2001 - 2065)
                        }
                    }

                    // Convert to UTC-aligned date if it was days since epoch, 
                    // because local timezone offset would shift it to previous day for negative offsets.
                    // For timestamps, local time is usually expected, but standard `toLocaleString` works.
                    if (t.includes('date') && !t.includes('timestamp')) {
                        const date = new Date(ms);
                        // Add timezone offset so it prints the correct date in local time
                        date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
                        if (!isNaN(date.getTime())) return date.toLocaleDateString();
                    } else {
                        const date = new Date(ms);
                        if (!isNaN(date.getTime())) return date.toLocaleString();
                    }
                } else if (typeof value === 'string') {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        const t = type.toLowerCase();
                        if (t.includes('date') && !t.includes('time') && !t.includes('timestamp')) {
                            return date.toLocaleDateString();
                        }
                        if (t.includes('time') && !t.includes('date') && !t.includes('timestamp')) {
                            return date.toLocaleTimeString();
                        }
                        return date.toLocaleString();
                    }
                }
            } catch (e) {
                // Ignore parse errors and fallback to string
            }
        }

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
