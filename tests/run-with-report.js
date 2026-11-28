/**
 * File: tests/run-with-report.js
 * PB-033: Menjalankan seluruh rangkaian pengujian regresi dengan satu perintah (`npm test`)
 * dan menghasilkan laporan otomatis di `tests/report.json`.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testFile = path.join(__dirname, 'regression.test.js');
const reportFile = path.join(__dirname, 'report.json');

const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
    encoding: 'utf8'
});

const stdout = result.stdout || '';
const stderr = result.stderr || '';

const lines = stdout.split(/\r?\n/);
const cases = [];
for (const line of lines) {
    const m = line.match(/^(ok|not ok)\s+(\d+)\s+-\s+(.+)$/);
    if (m) {
        cases.push({
            index: Number(m[2]),
            status: m[1] === 'ok' ? 'PASS' : 'FAIL',
            name: m[3].trim()
        });
    }
}

const passed = cases.filter(c => c.status === 'PASS').length;
const failed = cases.filter(c => c.status === 'FAIL').length;

const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    node_version: process.version,
    total: cases.length,
    passed,
    failed,
    success: result.status === 0 && failed === 0,
    cases
};

fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

console.log(`=== SABANGDOR REGRESSION TEST REPORT ===`);
console.log(`Total: ${report.total} | Lulus: ${report.passed} | Gagal: ${report.failed}`);
console.log(`Laporan otomatis tersimpan di: ${reportFile}`);

if (!report.success) {
    console.error('\nDetail kegagalan:\n' + stdout + '\n' + stderr);
    process.exit(result.status || 1);
}
