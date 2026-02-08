/**
 * DuckDB WASM Manager
 * Handles database initialization, file registration, and query execution
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import * as XLSX from 'xlsx';

export interface Column {
    name: string;
    type: string;
}

export interface TableSchema {
    name: string;
    columns: Column[];
    rowCount: number;
}

export interface QueryResult {
    columns: Column[];
    rows: unknown[][];
    totalRows: number;
    executionTime: number;
    isTruncated?: boolean;
}

type FileType = 'csv' | 'parquet' | 'xlsx' | 'sqlite' | 'json';

export class DuckDBManager {
    private db: duckdb.AsyncDuckDB | null = null;
    private conn: duckdb.AsyncDuckDBConnection | null = null;
    private assetsUri: string;
    private registeredTables: Map<string, string> = new Map(); // tableName -> fileName

    constructor(assetsUri: string) {
        this.assetsUri = assetsUri;
    }

    async initialize(): Promise<void> {
        // Select the best bundle for this browser
        const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
            mvp: {
                mainModule: `${this.assetsUri}/duckdb-mvp.wasm`,
                mainWorker: `${this.assetsUri}/duckdb-browser-mvp.worker.js`,
            },
            eh: {
                mainModule: `${this.assetsUri}/duckdb-eh.wasm`,
                mainWorker: `${this.assetsUri}/duckdb-browser-eh.worker.js`,
            },
        };

        try {
            const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

            // Create a blob URL for the worker to bypass cross-origin restrictions in webview
            const blob = new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'application/javascript' });
            const workerURL = URL.createObjectURL(blob);
            const worker = new Worker(workerURL);

            const logger = new duckdb.ConsoleLogger();

            this.db = new duckdb.AsyncDuckDB(logger, worker);
            await this.db.instantiate(bundle.mainModule);
            this.conn = await this.db.connect();
        } catch (error) {
            console.error('DuckDB initialization error:', error);
            throw error;
        }
    }

    async registerFile(
        tableName: string,
        data: Uint8Array,
        fileType: FileType,
        originalFileName: string
    ): Promise<void> {
        if (!this.db || !this.conn) {
            throw new Error('DuckDB not initialized');
        }

        // Make a copy for xlsx processing (registerFileBuffer may consume the buffer)
        const dataCopy = fileType === 'xlsx' ? new Uint8Array(data) : data;

        // Register the file in DuckDB's virtual file system
        const virtualFileName = `${tableName}.${fileType}`;
        await this.db.registerFileBuffer(virtualFileName, data);

        // Create table from file based on type
        let createTableSql: string;

        switch (fileType) {
            case 'csv':
                createTableSql = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}')`;
                break;
            case 'parquet':
                createTableSql = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${virtualFileName}')`;
                break;
            case 'json':
                createTableSql = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${virtualFileName}')`;
                break;
            case 'sqlite':
                // For SQLite, we attach it and copy tables
                await this.conn.query(`ATTACH '${virtualFileName}' AS attached_db (TYPE SQLITE)`);
                // Get tables from the attached database
                const tables = await this.conn.query(`SELECT name FROM attached_db.sqlite_master WHERE type='table'`);
                const tableNames = tables.toArray().map(row => row.name as string);
                // Copy each table with a prefix
                for (const t of tableNames) {
                    await this.conn.query(`CREATE OR REPLACE TABLE "${tableName}_${t}" AS SELECT * FROM attached_db."${t}"`);
                    this.registeredTables.set(`${tableName}_${t}`, originalFileName);
                }
                await this.conn.query(`DETACH attached_db`);
                return;
            case 'xlsx':
                // Use SheetJS to parse Excel files (works in webview without external requests)
                try {
                    const workbook = XLSX.read(dataCopy, {
                        type: 'array',
                        cellDates: true,
                        sheetStubs: true
                    });

                    const sheetNames = workbook.SheetNames;

                    if (sheetNames.length === 0) {
                        throw new Error('No sheets found in Excel file');
                    }

                    // Import each sheet as a separate table
                    for (const sheetName of sheetNames) {
                        const worksheet = workbook.Sheets[sheetName];
                        const wsKeys = Object.keys(worksheet);
                        const ref = worksheet['!ref'];

                        if (!ref || ref === 'A1') {
                            const cellKeys = wsKeys.filter(k => !k.startsWith('!'));
                            if (cellKeys.length === 0) {
                                continue; // Skip empty sheets
                            }
                        }

                        // Convert to JSON with header row
                        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                            header: 1,
                            defval: '',
                            blankrows: false,
                            raw: true
                        }) as unknown[][];

                        if (jsonData.length === 0) {
                            continue; // Skip empty sheets
                        }

                        // Find the first non-empty row for headers
                        let headerRowIndex = 0;
                        while (headerRowIndex < jsonData.length) {
                            const row = jsonData[headerRowIndex] as unknown[];
                            if (row && row.length > 0 && row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
                                break;
                            }
                            headerRowIndex++;
                        }

                        if (headerRowIndex >= jsonData.length) {
                            continue; // Skip sheets with no valid data
                        }

                        // First valid row is headers
                        const headerRow = jsonData[headerRowIndex] as unknown[];
                        const headers: string[] = [];

                        // Determine the number of columns from the first row
                        const numCols = headerRow.length;


                        for (let i = 0; i < numCols; i++) {
                            const h = headerRow[i];
                            let header = h != null && h !== '' ? String(h).trim() : `column_${i + 1}`;
                            // Sanitize header names
                            header = header.replace(/[^a-zA-Z0-9_]/g, '_') || `column_${i + 1}`;
                            headers.push(header);
                        }

                        if (headers.length === 0) {
                            continue; // Skip sheets with no columns
                        }

                        // Build table name
                        const safeSheetName = sheetName.replace(/[^a-zA-Z0-9_]/g, '_');
                        const sheetTableName = sheetNames.length === 1
                            ? tableName
                            : `${tableName}_${safeSheetName}`;

                        // Create column definitions (all as VARCHAR initially)
                        const columnDefs = headers.map(h => `"${h}" VARCHAR`).join(', ');
                        await this.conn.query(`CREATE OR REPLACE TABLE "${sheetTableName}" (${columnDefs})`);

                        // Insert data rows (skip header row)
                        let insertedRows = 0;
                        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
                            const row = jsonData[i] as unknown[];
                            if (!row || row.length === 0) continue;

                            const values = headers.map((_, colIdx) => {
                                const val = row[colIdx];
                                if (val === null || val === undefined || val === '') return 'NULL';
                                // Escape single quotes
                                return `'${String(val).replace(/'/g, "''")}'`;
                            }).join(', ');
                            await this.conn.query(`INSERT INTO "${sheetTableName}" VALUES (${values})`);
                            insertedRows++;
                        }


                        this.registeredTables.set(sheetTableName, originalFileName);
                    }
                    return; // Already handled table registration
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    console.error('Excel parsing error:', errorMsg, error);
                    throw new Error(`Failed to load Excel file: ${errorMsg}`);
                }
            default:
                throw new Error(`Unsupported file type: ${fileType}`);
        }

        await this.conn.query(createTableSql);
        this.registeredTables.set(tableName, originalFileName);
    }

    async executeQuery(sql: string): Promise<QueryResult> {
        if (!this.conn) {
            throw new Error('DuckDB not initialized');
        }

        const result = await this.conn.query(sql);

        // Extract column information
        const columns: Column[] = result.schema.fields.map(field => ({
            name: field.name,
            type: this.mapArrowType(field.type),
        }));

        // Convert to array of arrays
        const rows: unknown[][] = [];
        const data = result.toArray();

        for (const row of data) {
            const rowData: unknown[] = [];
            for (const col of columns) {
                rowData.push(row[col.name]);
            }
            rows.push(rowData);
        }

        // Limit to 10,000 rows
        const MAX_ROWS = 10000;
        let isTruncated = false;

        if (rows.length > MAX_ROWS) {
            rows.length = MAX_ROWS;
            isTruncated = true;
        }

        return {
            columns,
            rows,
            totalRows: isTruncated ? MAX_ROWS : rows.length,
            executionTime: 0, // Will be set by caller
            isTruncated
        };
    }

    async getTableSchemas(): Promise<TableSchema[]> {
        if (!this.conn) {
            throw new Error('DuckDB not initialized');
        }

        const schemas: TableSchema[] = [];

        // Get all tables
        const tablesResult = await this.conn.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'main'
            ORDER BY table_name
        `);

        const tableNames = tablesResult.toArray().map(row => row.table_name as string);

        for (const tableName of tableNames) {
            // Get columns for this table
            const columnsResult = await this.conn.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '${tableName}' AND table_schema = 'main'
                ORDER BY ordinal_position
            `);

            const columns: Column[] = columnsResult.toArray().map(row => ({
                name: row.column_name as string,
                type: row.data_type as string,
            }));

            // Get row count
            const countResult = await this.conn.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
            const rowCount = Number(countResult.toArray()[0].cnt);

            schemas.push({
                name: tableName,
                columns,
                rowCount,
            });
        }

        return schemas;
    }

    async exportResults(sql: string, format: 'csv' | 'parquet'): Promise<Uint8Array> {
        if (!this.db || !this.conn) {
            throw new Error('DuckDB not initialized');
        }

        const exportFileName = `export.${format}`;

        // Remove trailing semicolons to prevent syntax errors in COPY command
        const cleanSql = sql.trim().replace(/;+$/, '');

        // Use COPY TO to export
        if (format === 'csv') {
            await this.conn.query(`COPY (${cleanSql}) TO '${exportFileName}' (FORMAT CSV, HEADER)`);
        } else {
            // Use uncompressed codec to avoid WASM issues with Snappy
            await this.conn.query(`COPY (${cleanSql}) TO '${exportFileName}' (FORMAT PARQUET, CODEC 'UNCOMPRESSED')`);
        }

        // Read the exported file
        const buffer = await this.db.copyFileToBuffer(exportFileName);
        return buffer;
    }

    private mapArrowType(type: unknown): string {
        // Map Arrow type to readable string
        const typeStr = String(type);

        // Common mappings
        if (typeStr.includes('Int64') || typeStr.includes('Int32')) { return 'INTEGER'; }
        if (typeStr.includes('Float') || typeStr.includes('Double')) { return 'DOUBLE'; }
        if (typeStr.includes('Utf8') || typeStr.includes('String')) { return 'VARCHAR'; }
        if (typeStr.includes('Bool')) { return 'BOOLEAN'; }
        if (typeStr.includes('Date')) { return 'DATE'; }
        if (typeStr.includes('Timestamp')) { return 'TIMESTAMP'; }
        if (typeStr.includes('Decimal')) { return 'DECIMAL'; }

        return typeStr;
    }

    async removeTable(tableName: string): Promise<void> {
        if (!this.conn) {
            throw new Error('DuckDB not initialized');
        }

        await this.conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
        this.registeredTables.delete(tableName);
    }

    async close(): Promise<void> {
        if (this.conn) {
            await this.conn.close();
            this.conn = null;
        }
        if (this.db) {
            await this.db.terminate();
            this.db = null;
        }
    }
}
