import fs from 'fs';

const date = new Date().toISOString().split('T')[0];

const fileSizeRaw = fs.readFileSync(`reports/audit/raw-check-file-size-${date}.log`, 'utf8');
const innerHtmlRaw = fs.readFileSync(`reports/audit/raw-check-innerhtml-${date}.log`, 'utf8');
const lintRaw = fs.readFileSync(`reports/audit/raw-lint-${date}.log`, 'utf8');

fs.writeFileSync(`reports/audit/file-size-report-${date}.json`, JSON.stringify({ raw: fileSizeRaw }));
fs.writeFileSync(`reports/audit/innerhtml-report-${date}.json`, JSON.stringify({ raw: innerHtmlRaw }));
fs.writeFileSync(`reports/audit/lint-report-${date}.json`, JSON.stringify({ raw: lintRaw }));

const mdReport = `Title: Audit Report — ${date} (default branch)

**Summary**
* Date: ${date}

**Artifacts**
* file-size-report-${date}.json
* innerhtml-report-${date}.json
* lint-report-${date}.json
`;

fs.writeFileSync(`reports/audit/audit-report-${date}.md`, mdReport);
