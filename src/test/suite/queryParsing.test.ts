import * as assert from 'assert';

suite('Query Parsing Test Suite', () => {
    
    // Extracted from SqlEditor.extractQueryAtOffset for testing
    function extractQueryAtOffset(text: string, offset: number): string {
        let inString = false;
        let stringChar = '';
        let lastQueryStart = 0;
        let queryRanges: {start: number, end: number}[] = [];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (inString) {
                if (char === stringChar) {
                    if (i + 1 < text.length && text[i+1] === stringChar) {
                        i++; 
                    } else {
                        inString = false;
                    }
                }
            } else {
                if (char === "'" || char === '"') {
                    inString = true;
                    stringChar = char;
                } else if (char === ';') {
                    queryRanges.push({start: lastQueryStart, end: i + 1});
                    lastQueryStart = i + 1;
                }
            }
        }
        
        if (lastQueryStart < text.length && text.substring(lastQueryStart).trim().length > 0) {
            queryRanges.push({start: lastQueryStart, end: text.length});
        }

        for (let i = 0; i < queryRanges.length; i++) {
            const range = queryRanges[i];
            if (offset >= range.start && offset <= range.end) {
                const query = text.substring(range.start, range.end).trim();
                if (query.length > 0) return query;
            }
        }

        for (let i = queryRanges.length - 1; i >= 0; i--) {
             const query = text.substring(queryRanges[i].start, queryRanges[i].end).trim();
             if (query.length > 0) return query;
        }

        return text.trim();
    }

    test('Should extract single query', () => {
        const sql = 'SELECT * FROM table;';
        assert.strictEqual(extractQueryAtOffset(sql, 5), 'SELECT * FROM table;');
    });

    test('Should extract query with cursor at start', () => {
        const sql = 'SELECT * FROM t1; SELECT * FROM t2;';
        assert.strictEqual(extractQueryAtOffset(sql, 0), 'SELECT * FROM t1;');
    });

    test('Should extract query with cursor at end', () => {
        const sql = 'SELECT * FROM t1; SELECT * FROM t2;';
        assert.strictEqual(extractQueryAtOffset(sql, sql.length), 'SELECT * FROM t2;');
    });

    test('Should extract correct query among multiple', () => {
        const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
        assert.strictEqual(extractQueryAtOffset(sql, 15), 'SELECT 2;');
    });

    test('Should ignore semicolons inside strings', () => {
        const sql = "SELECT 'hello;world'; SELECT 2;";
        assert.strictEqual(extractQueryAtOffset(sql, 5), "SELECT 'hello;world';");
    });
});
