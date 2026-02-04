# VSCode SQL Explorer

A VSCode extension for querying data files (CSV, Parquet, XLSX, SQLite) using SQL, powered by DuckDB.

## Features

- **Drag & Drop Files**: Load CSV, Parquet, XLSX, SQLite files directly
- **SQL Editor**: Write SQL with syntax highlighting and autocomplete
- **Join Across Files**: Query and join data from different files
- **CTEs Support**: Use Common Table Expressions for complex queries
- **Virtual Scrolling**: View large result sets efficiently
- **Schema Explorer**: Browse tables and columns
- **Export Results**: Download query results as CSV or Parquet

## Quick Start

1. Open the SQL Explorer panel: `Ctrl+Shift+P` → "SQL Explorer: Open"
2. Drag data files into the drop zone
3. Write SQL in the editor
4. Press `Ctrl+Enter` to execute
5. View results in the grid below

## Supported File Types

| Type | Extension | Notes |
|------|-----------|-------|
| CSV | .csv | Auto-detects delimiter |
| Parquet | .parquet | Native support |
| Excel | .xlsx, .xls | Requires spatial extension |
| SQLite | .sqlite, .db | Attach as database |
| JSON | .json | JSON/NDJSON files |

## Example Queries

```sql
-- Simple query
SELECT * FROM sales WHERE amount > 100;

-- Join across files
SELECT c.name, SUM(o.total)
FROM customers c
JOIN orders o ON c.id = o.customer_id
GROUP BY c.name;

-- CTE example
WITH monthly_sales AS (
    SELECT 
        DATE_TRUNC('month', order_date) as month,
        SUM(amount) as total
    FROM orders
    GROUP BY 1
)
SELECT * FROM monthly_sales ORDER BY month;
```

## Development

See [docs/architecture.md](docs/architecture.md) for technical details.

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
npm install
npm run build
```

### Running in Development

Press `F5` in VSCode to launch the extension development host.

## License

MIT
