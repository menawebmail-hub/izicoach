// INFORME DE COBRO as a styled .xlsx. Pure presentation of the rows Cobros already computes
// (buildCobrosExportRows in App.jsx, grouped by groupCobrosReportRows): this module never derives
// or filters data. ExcelJS is loaded with a dynamic import so it ships as its own chunk, fetched
// only when the report is opened — never part of the initial bundle.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const COBROS_REPORT_COLORS = {
  title: "FF0D1B4B",
  headerBg: "FF0D1B4B",
  headerText: "FFFFFFFF",
  groupBg: ["FFF6F7F9", "FFE6E8EC"],
  estado: { Pagado: "FF1E7B34", "En mora": "FFC62828", Pendiente: "FFB26A00" },
};

export const cobrosEstadoColor = (estado) => {
  if (estado === "Pagado") return COBROS_REPORT_COLORS.estado.Pagado;
  if (estado === "En mora") return COBROS_REPORT_COLORS.estado["En mora"];
  if (typeof estado === "string" && estado.startsWith("Pendiente")) return COBROS_REPORT_COLORS.estado.Pendiente;
  return null;
};

export const cobrosReportFileName = (isoDate) => "Informe de cobro " + isoDate + ".xlsx";

const TITLE_ROW = 1;
const DATE_ROW = 2;
const HEADER_ROW = 3;

// groups: [{ studentId, name, rows: [{ <column>: value, ... }] }] — rows keyed by column label.
// Returns the .xlsx bytes (ArrayBuffer/Buffer from ExcelJS writeBuffer).
export async function buildCobrosReportXlsx({ groups, columns, dateLabel }) {
  const mod = await import("exceljs");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "izicoach";
  const ws = wb.addWorksheet("Informe de cobro", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });
  const lastCol = columns.length;
  const alumnoCol = columns.indexOf("Alumno") + 1;
  const montoCol = columns.indexOf("Monto") + 1;
  const estadoCol = columns.indexOf("Estado") + 1;

  ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, lastCol);
  const title = ws.getCell(TITLE_ROW, 1);
  title.value = "INFORME DE COBRO";
  title.font = { bold: true, size: 16, color: { argb: COBROS_REPORT_COLORS.title } };
  ws.mergeCells(DATE_ROW, 1, DATE_ROW, lastCol);
  const date = ws.getCell(DATE_ROW, 1);
  date.value = dateLabel;
  date.font = { size: 11, color: { argb: COBROS_REPORT_COLORS.title } };

  const header = ws.getRow(HEADER_ROW);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col;
    cell.font = { bold: true, color: { argb: COBROS_REPORT_COLORS.headerText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COBROS_REPORT_COLORS.headerBg } };
    cell.alignment = { vertical: "middle" };
  });

  let r = HEADER_ROW + 1;
  groups.forEach((g, gi) => {
    const fill = { type: "pattern", pattern: "solid", fgColor: { argb: COBROS_REPORT_COLORS.groupBg[gi % 2] } };
    const first = r;
    g.rows.forEach((row, ri) => {
      const xr = ws.getRow(r);
      columns.forEach((col, i) => {
        const cell = xr.getCell(i + 1);
        const v = row[col];
        if (i + 1 === alumnoCol) cell.value = ri === 0 ? g.name : null;
        else cell.value = v === "" || v === undefined ? null : v;
        cell.fill = fill;
        if (i + 1 === montoCol && typeof cell.value === "number") cell.numFmt = "#,##0";
        if (i + 1 === estadoCol) {
          const c = cobrosEstadoColor(v);
          if (c) cell.font = { bold: true, color: { argb: c } };
        }
      });
      r++;
    });
    const last = r - 1;
    // One merged Alumno cell per student group (studentId), never across groups — two students
    // with the same name stay two separate merges.
    if (last > first) ws.mergeCells(first, alumnoCol, last, alumnoCol);
    const nameCell = ws.getCell(first, alumnoCol);
    nameCell.font = { bold: true, color: { argb: COBROS_REPORT_COLORS.title } };
    nameCell.alignment = { vertical: "top", wrapText: true };
  });

  columns.forEach((col, i) => {
    let w = col.length;
    groups.forEach((g) => g.rows.forEach((row) => {
      const v = i + 1 === alumnoCol ? g.name : row[col];
      const len = typeof v === "number" ? String(Math.round(v)).length + 2 : String(v ?? "").length;
      if (len > w) w = len;
    }));
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 40);
  });

  return wb.xlsx.writeBuffer();
}
