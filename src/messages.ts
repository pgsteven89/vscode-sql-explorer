/**
 * Message types for communication between extension and webview
 */

export type FileType = 'csv' | 'parquet' | 'xlsx' | 'sqlite' | 'json';

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
}

// Messages from Extension to Webview
export interface AddFileMessage {
    type: 'addFile';
    fileName: string;
    fileData: number[]; // Serialized Uint8Array
    fileType: FileType;
}

// Messages from Webview to Extension
export interface ReadyMessage {
    type: 'ready';
}

export interface PickFileMessage {
    type: 'pickFile';
}

export interface DownloadResultsMessage {
    type: 'downloadResults';
    format: 'csv' | 'parquet';
    data: number[]; // Serialized Uint8Array
}

export interface ErrorMessage {
    type: 'error';
    error: string;
}

export interface LogMessage {
    type: 'log';
    message: string;
}

export interface QueryResultMessage {
    type: 'queryResult';
    columns: Column[];
    rows: unknown[][];
    totalRows: number;
    executionTime: number;
}

export interface QueryErrorMessage {
    type: 'queryError';
    error: string;
}

export interface RequestExportMessage {
    type: 'requestExport';
    format: 'csv' | 'parquet';
}

// Union type for all messages
export type Message =
    | AddFileMessage
    | ReadyMessage
    | PickFileMessage
    | DownloadResultsMessage
    | ErrorMessage
    | LogMessage
    | QueryResultMessage
    | QueryErrorMessage
    | RequestExportMessage;

