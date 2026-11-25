/**
 * Report export actions (Phase 59): HTML + PDF into <project>/report/
 * through the backend, or download / print the HTML in the browser.
 */
import { useAppStore } from '../store/appStore';
import { useAuditStore } from '../store/auditStore';
import { useProjectStore } from '../store/projectStore';
import { useReportStore } from '../store/reportStore';
import { BDL_FACTOR_OPTIONS } from './censoring';
import { buildReportHtml } from './reportHtml';
import { exportReportFiles, projectFilesAvailable, ReportExportResult } from '../services/projectFiles';

export function currentReportHtml(): string {
    const app = useAppStore.getState();
    const project = useProjectStore.getState();
    const { title, author, items } = useReportStore.getState();
    return buildReportHtml({ title, author, items }, useAuditStore.getState().entries, {
        projectName: project.currentProject?.name || 'Untitled project',
        projectPath: project.projectPath,
        rowCount: app.columnarData.rowCount,
        columnCount: app.columns.length,
        bdl: BDL_FACTOR_OPTIONS.find(o => o.value === app.bdlFactor)?.label ?? null,
        generated: new Date(),
    });
}

export function reportFileName(): string {
    const name = useProjectStore.getState().currentProject?.name || 'Project';
    return `${name.replace(/[^\w .()+-]+/g, '_').trim() || 'Project'} report`;
}

/** Write report.html (+ .pdf) into the project's report/ folder; null when the project has no folder */
export async function exportReportToProject(pdf = true): Promise<ReportExportResult | null> {
    const path = useProjectStore.getState().projectPath;
    if (!path || !(await projectFilesAvailable())) return null;
    const html = new Blob([currentReportHtml()], { type: 'text/html' });
    return exportReportFiles(path, reportFileName(), html, pdf);
}

export function downloadReportHtml(): void {
    const url = URL.createObjectURL(new Blob([currentReportHtml()], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportFileName()}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Browser print dialog for the report (Save as PDF when no project folder) */
export function printReport(): void {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = currentReportHtml();
    frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
}
