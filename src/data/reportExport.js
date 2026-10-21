// Generic CSV / Excel download used by every report.
// `table` = { name: "file-name-without-extension", headers: [...], rows: [[...], ...] }

// Stops spreadsheet apps from running a cell as a formula (CSV injection),
// while leaving ordinary phone numbers such as "+95 9 123 456" untouched.
function guardFormula(value) {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-][\d\s().-]+$/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function csvCell(value) {
  const text = guardFormula(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportTableCsv({ name, headers, rows }) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  // The BOM makes Excel read the file as UTF-8 (needed for non-Latin names).
  const csv = "﻿" + lines.join("\r\n");

  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
}

export async function exportTableXlsx({ name, headers, rows }) {
  // Loaded only when needed so the app stays light.
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");

  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    // Numbers stay numbers; codes and phone numbers are text, so leading zeroes survive.
    ...rows.map((row) => row.map((value) => value ?? "")),
  ]);

  sheet["!cols"] = headers.map((header, column) => {
    const longest = rows
      .slice(0, 200)
      .reduce((max, row) => Math.max(max, String(row[column] ?? "").length), header.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  XLSX.writeFile(workbook, `${name}.xlsx`);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
