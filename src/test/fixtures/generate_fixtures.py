import sqlite3
import json
import csv
import pandas as pd
import os

os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
base_path = os.path.dirname(os.path.abspath(__file__))

# 1. sample.csv
with open(os.path.join(base_path, 'sample.csv'), 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'name'])
    writer.writerow([1, 'Alice'])
    writer.writerow([2, 'Bob'])

# 2. sample.json
with open(os.path.join(base_path, 'sample.json'), 'w') as f:
    json.dump([{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}], f)

# 2a. sample.jsonl
with open(os.path.join(base_path, 'sample.jsonl'), 'w') as f:
    f.write('{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}\n')

# 2b. sample.ndjson
with open(os.path.join(base_path, 'sample.ndjson'), 'w') as f:
    f.write('{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}\n')

# 3. sample.sqlite
sqlite_path = os.path.join(base_path, 'sample.sqlite')
if os.path.exists(sqlite_path):
    os.remove(sqlite_path)
conn = sqlite3.connect(sqlite_path)
cursor = conn.cursor()
cursor.execute('CREATE TABLE users (id INTEGER, name TEXT)')
cursor.execute("INSERT INTO users VALUES (1, 'Alice')")
cursor.execute("INSERT INTO users VALUES (2, 'Bob')")
conn.commit()
conn.close()


# Use pandas for parquet and xlsx
df = pd.DataFrame({'id': [1, 2], 'name': ['Alice', 'Bob']})

# 4. sample.parquet
df.to_parquet(os.path.join(base_path, 'sample.parquet'))

# 5. sample.xlsx
df.to_excel(os.path.join(base_path, 'sample.xlsx'), index=False)

print("Fixtures generated.")
