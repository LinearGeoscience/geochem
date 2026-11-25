/**
 * Report export (Phase 59): one self-contained HTML file (figures embedded)
 * laid out for A4 printing, so the same file becomes report.pdf. Contents:
 * summary, the notebook (notes and figures with the data steps between
 * them), a figure list and the full data processing log.
 */
import type { ReportData, ReportFigure, ReportNote, ReportTable } from '../store/reportStore';
import { figureNumbers, interleaveSteps, tableNumbers } from '../store/reportStore';
import type { AuditEntry } from '../types/audit';

export interface ReportContext {
    projectName: string;
    projectPath: string | null;
    rowCount: number;
    columnCount: number;
    /** Below-detection handling, in words */
    bdl: string | null;
    generated: Date;
}

const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text to paragraphs: blank lines split paragraphs, single newlines break lines */
export function paragraphs(text: string): string {
    return text.trim().split(/\n\s*\n/).filter(Boolean)
        .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; color: #1d2329; margin: 0 auto; max-width: 900px; padding: 24px; }
h1 { font-size: 22pt; margin: 0 0 4px; font-weight: 600; }
h2 { font-size: 14pt; margin: 28px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #d0d7de; }
h3 { font-size: 11.5pt; margin: 18px 0 6px; }
.meta { color: #57606a; margin-bottom: 16px; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
th, td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid #e5e9ed; }
th { background: #f3f5f7; font-weight: 600; }
.log td:nth-child(2), .log td:nth-child(3) { white-space: nowrap; }
.summary td:first-child { width: 28%; color: #57606a; }
.note { margin: 14px 0; }
.figure { margin: 18px 0; break-inside: avoid; page-break-inside: avoid; }
.table { margin: 18px 0; break-inside: avoid; page-break-inside: avoid; }
.table .caption { margin: 0 0 6px; }
.figure img { display: block; max-width: 100%; max-height: 190mm; margin: 0 auto; border: 1px solid #e5e9ed; }
.caption { margin-top: 6px; }
.caption b { font-weight: 600; }
.context { color: #57606a; font-size: 8.5pt; margin-top: 2px; }
.steps { border-left: 3px solid #d0d7de; padding: 2px 0 2px 10px; margin: 12px 0; font-size: 9pt; color: #3d444d; break-inside: avoid; }
.steps div { margin: 2px 0; }
.steps .t { color: #8c959f; margin-left: 6px; }
.mono { font-family: Consolas, "Courier New", monospace; font-size: 8.5pt; }
.appendix { break-before: page; page-break-before: always; }
footer { margin-top: 32px; color: #8c959f; font-size: 8.5pt; }
@media print { body { padding: 0; max-width: none; } }
`;

function figureHtml(f: ReportFigure, n: number): string {
    const imgs = f.images.map((src, i) =>
        `<img src="${src}" alt="Figure ${n}${f.images.length > 1 ? ` (${i + 1})` : ''}: ${esc(f.title)}">`).join('\n');
    const context = [f.plotType, ...f.context].filter(Boolean).map(esc).join(' · ');
    return `<div class="figure" id="fig-${n}">
${imgs}
<div class="caption"><b>Figure ${n}.</b> ${esc(f.title)}${f.caption.trim() ? ` — ${esc(f.caption.trim()).replace(/\n/g, '<br>')}` : ''}</div>
${context ? `<div class="context">${context}</div>` : ''}
</div>`;
}

function tableHtml(t: ReportTable, n: number): string {
    const head = `<tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const body = t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="table" id="tab-${n}">
<div class="caption"><b>Table ${n}.</b> ${esc(t.title)}${t.caption.trim() ? ` — ${esc(t.caption.trim())}` : ''}</div>
<table><thead>${head}</thead><tbody>${body}</tbody></table>
</div>`;
}

function noteHtml(n: ReportNote): string {
    return `<div class="note">${n.title.trim() ? `<h3>${esc(n.title)}</h3>` : ''}${paragraphs(n.text)}</div>`;
}

function stepsHtml(steps: AuditEntry[]): string {
    return `<div class="steps">${steps.map(s =>
        `<div><b>${esc(s.operation)}</b> · ${esc(s.description)}<span class="t">${esc(when(s.timestamp))}</span></div>`).join('')}</div>`;
}

function logTable(audit: AuditEntry[]): string {
    if (!audit.length) return '<p>No data processing steps were recorded.</p>';
    const rows = [...audit].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((s, i) => {
        const detail = [
            s.details && esc(s.details),
            s.mathFormula && `<span class="mono">${esc(s.mathFormula)}</span>`,
            s.inputColumns?.length && `Inputs: ${esc(s.inputColumns.join(', '))}`,
            s.outputColumns?.length && `Outputs: ${esc(s.outputColumns.join(', '))}`,
            s.rowsAffected != null && `Rows affected: ${s.rowsAffected.toLocaleString()}`,
            s.reference && `Ref: ${esc(s.reference)}`,
        ].filter(Boolean).join('<br>');
        return `<tr><td>${i + 1}</td><td>${esc(when(s.timestamp))}</td><td>${esc(s.operation)}</td><td>${esc(s.description)}${detail ? `<br><span class="context">${detail}</span>` : ''}</td></tr>`;
    });
    return `<table class="log"><thead><tr><th>#</th><th>When</th><th>Step</th><th>Description</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function buildReportHtml(report: ReportData, audit: AuditEntry[], ctx: ReportContext): string {
    const title = report.title.trim() || `${ctx.projectName} — interpretation report`;
    const numbers = figureNumbers(report.items);
    const tables = tableNumbers(report.items);
    const figures = report.items.filter((i): i is ReportFigure => i.kind === 'figure');
    const body = interleaveSteps(report.items, audit).map(row => {
        if (row.kind === 'steps') return stepsHtml(row.steps);
        const it = row.item;
        if (it.kind === 'note') return noteHtml(it);
        if (it.kind === 'table') return tableHtml(it, tables.get(it.id)!);
        return figureHtml(it, numbers.get(it.id)!);
    }).join('\n');
    const summary = [
        ['Project', esc(ctx.projectName)],
        ctx.projectPath && ['Project file', `<span class="mono">${esc(ctx.projectPath)}</span>`],
        ['Dataset', `${ctx.rowCount.toLocaleString()} rows × ${ctx.columnCount} columns`],
        ctx.bdl && ['Below-detection values', esc(ctx.bdl)],
        ['Contents', [
            count(report.items.filter(i => i.kind === 'note').length, 'note'),
            count(figures.length, 'figure'),
            ...(tables.size ? [count(tables.size, 'table')] : []),
            count(audit.length, 'data processing step'),
        ].join(', ')],
    ].filter(Boolean) as [string, string][];
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">${report.author.trim() ? `${esc(report.author)} · ` : ''}${esc(ctx.generated.toLocaleDateString(undefined, { dateStyle: 'long' }))}</div>
<table class="summary">${summary.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
<h2>Workflow</h2>
${body || '<p>The report has no entries yet.</p>'}
${figures.length ? `<h2>List of figures</h2><table><tbody>${figures.map(f => `<tr><td>Figure ${numbers.get(f.id)}</td><td>${esc(f.title)}</td><td>${esc(when(f.created))}</td></tr>`).join('')}</tbody></table>` : ''}
<section class="appendix">
<h2>Appendix: data processing log</h2>
${logTable(audit)}
</section>
<footer>Generated by GeoChem on ${esc(ctx.generated.toLocaleString())}.</footer>
</body>
</html>
`;
}
