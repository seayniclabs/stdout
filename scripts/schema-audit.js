#!/usr/bin/env node
import Database from 'better-sqlite3';
import * as schema from './src/lib/db/schema.js';

const db = new Database('/Users/charlieseay/Projects/stdout/data/stdout.db');

// Get all table names from schema
const tableNames = Object.keys(schema).filter(name =>
  schema[name] && typeof schema[name] === 'object' && schema[name]._.name
);

console.log('\n=== Schema vs Database Column Audit ===\n');

for (const tableName of tableNames) {
  const table = schema[tableName];
  const dbTableName = table._.name;

  // Get columns from database
  const dbCols = db.prepare(`PRAGMA table_info(${dbTableName})`).all();
  const dbColNames = new Set(dbCols.map(c => c.name));

  // Get columns from schema
  const schemaColNames = new Set(Object.keys(table).filter(k => k !== '_'));

  // Find missing columns (in schema but not in DB)
  const missing = [];
  for (const col of schemaColNames) {
    const columnDef = table[col];
    if (columnDef && columnDef.name && !dbColNames.has(columnDef.name)) {
      missing.push({ jsName: col, dbName: columnDef.name, type: columnDef.dataType });
    }
  }

  if (missing.length > 0) {
    console.log(`\n📋 ${dbTableName}:`);
    console.log(`   Database has ${dbColNames.size} columns, schema expects ${schemaColNames.size}`);
    console.log(`   Missing ${missing.length} columns:\n`);
    for (const m of missing) {
      console.log(`   - ${m.dbName} (${m.type})`);
    }
  }
}

db.close();
console.log('\n=== Audit Complete ===\n');
