/**
 * On-demand .xlsx snapshot via ExcelJS.
 *
 * A snapshot, not a workspace: the first row of every sheet says so. Edits made
 * here are lost on the next export, because the database is the source of truth
 * and this file is a view of it.
 */

import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import type { LeadStore } from '../store/index.js';
import { buildWorkbookData, type BuildWorkbookOptions, type SheetTable } from './workbook.js';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F3A5F' },
};

const BANNER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF3CD' },
};

const SEGMENT_COLOURS: Record<string, string> = {
  A: 'FFC6EFCE',
  B: 'FFDDEBF7',
  C: 'FFFFF2CC',
  D: 'FFF8D7DA',
};

export interface ExportOptions extends BuildWorkbookOptions {
  /** Full output path. Defaults to `<EXPORT_DIR>/fabritec-leads-<date>.xlsx`. */
  outPath?: string;
}

export interface ExportResult {
  path: string;
  filename: string;
  sheetCount: number;
  rowCount: number;
}

export async function exportWorkbook(
  store: LeadStore,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const data = await buildWorkbookData(store, options);

  const filename = `fabritec-leads-${data.generatedAt.slice(0, 10)}.xlsx`;
  const outPath = resolve(options.outPath ?? join(config.export.outDir, filename));
  await mkdir(dirname(outPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fabritec Lead Intelligence';
  workbook.created = new Date(data.generatedAt);

  addSummarySheet(workbook, data);
  for (const sheet of data.sheets) addSheet(workbook, sheet, data.generatedAt);

  await workbook.xlsx.writeFile(outPath);

  return {
    path: outPath,
    filename,
    sheetCount: workbook.worksheets.length,
    rowCount: data.sheets.reduce((sum, s) => sum + s.rows.length, 0),
  };
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  data: Awaited<ReturnType<typeof buildWorkbookData>>,
): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [
    { key: 'a', width: 34 },
    { key: 'b', width: 18 },
    { key: 'c', width: 60 },
  ];

  sheet.addRow(['Fabritec Lead Intelligence']).font = { bold: true, size: 16 };
  sheet.addRow([`Generated ${data.generatedAt.slice(0, 19).replace('T', ' ')} UTC`]);
  sheet.addRow([]);

  const warning = sheet.addRow([
    'This workbook is a snapshot. Edit leads in the app — changes made here are not saved back.',
  ]);
  warning.font = { bold: true, color: { argb: 'FF7A5C00' } };
  warning.getCell(1).fill = BANNER_FILL;
  sheet.mergeCells(warning.number, 1, warning.number, 3);
  sheet.addRow([]);

  const headerRow = sheet.addRow(['Metric', 'Value', '']);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });

  const stats: [string, number][] = [
    ['Total leads in database', data.stats.total],
    ['Qualified (A + B)', data.stats.qualified],
    ['Nurture (C)', data.stats.nurture],
    ['Awaiting human review', data.stats.review],
    ['Rejected', data.stats.rejected],
    ['Contacts', data.stats.contacts],
    ['New this week', data.stats.newThisWeek],
    ['Derived segments', data.segments.length],
  ];
  for (const [label, value] of stats) sheet.addRow([label, value]);

  sheet.addRow([]);
  const segHeader = sheet.addRow(['Segment', 'Leads', 'Average Score']);
  segHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  segHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });

  for (const segment of data.segments) {
    const row = sheet.addRow([segment.label, segment.count, segment.avg_score]);
    const colour = SEGMENT_COLOURS[segment.parts.tier];
    if (colour) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
    }
  }
}

function addSheet(workbook: ExcelJS.Workbook, table: SheetTable, generatedAt: string): void {
  const sheet = workbook.addWorksheet(table.name);

  const banner = sheet.addRow([
    `${table.name} · snapshot generated ${generatedAt.slice(0, 10)} · do not edit, this file is regenerated`,
  ]);
  banner.font = { italic: true, color: { argb: 'FF7A5C00' } };
  banner.getCell(1).fill = BANNER_FILL;
  sheet.mergeCells(1, 1, 1, Math.max(table.columns.length, 1));

  const header = sheet.addRow(table.columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  header.height = 28;

  table.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  for (const row of table.rows) sheet.addRow(row);

  if (table.freezeHeader) {
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    if (table.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2 + table.rows.length, column: table.columns.length },
      };
    }
  }

  colourSegmentColumn(sheet, table);
}

/** Tints the priority-segment cell so A/B/C/D reads at a glance. */
function colourSegmentColumn(sheet: ExcelJS.Worksheet, table: SheetTable): void {
  const index = table.columns.findIndex((c) => c.key === 'priority_segment');
  if (index === -1) return;

  for (let i = 0; i < table.rows.length; i += 1) {
    const value = table.rows[i]?.[index];
    if (typeof value !== 'string') continue;
    const colour = SEGMENT_COLOURS[value];
    if (!colour) continue;
    // +3: one banner row, one header row, and ExcelJS rows are 1-indexed.
    const cell = sheet.getRow(i + 3).getCell(index + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
    cell.font = { bold: true };
  }
}
