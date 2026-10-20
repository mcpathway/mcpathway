import { formatMemberCode } from "./memberRepository.js";

const COLUMNS = [
  ["Code", (m) => formatMemberCode(m.code_number)],
  ["Name", (m) => m.name],
  ["Membership level", (m) => m.membership_levels?.name],
  ["Membership expiry date", (m) => m.membership_expiry_date],
  ["Education background", (m) => m.education_background],
  ["Organisation", (m) => m.organisation],
  ["Position", (m) => m.position],
  ["Email", (m) => m.email],
  ["Address", (m) => m.address],
  ["Phone", (m) => m.phone],
  ["Specialisation", (m) => m.specialisation],
  ["Status", (m) => (m.status === "suspended" ? "Suspended" : "Active")],
];

function toRows(members) {
  return members.map((member) =>
    COLUMNS.map(([, getter]) => String(getter(member) ?? ""))
  );
}

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
  const text = guardFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportMembersCsv(members) {
  const header = COLUMNS.map(([label]) => csvCell(label)).join(",");
  const lines = toRows(members).map((row) => row.map(csvCell).join(","));
  // The BOM makes Excel read the file as UTF-8 (needed for non-Latin names).
  const csv = "\uFEFF" + [header, ...lines].join("\r\n");

  download(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `members-${today()}.csv`,
  );
}

export async function exportMembersXlsx(members) {
  // Loaded only when needed so the app stays light.
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");

  const sheet = XLSX.utils.aoa_to_sheet([
    COLUMNS.map(([label]) => label),
    ...toRows(members),
  ]);
  sheet["!cols"] = COLUMNS.map(([label]) => ({ wch: Math.max(label.length + 2, 16) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Members");
  // All cells are strings, so leading zeroes in codes/phones are preserved.
  XLSX.writeFile(workbook, `members-${today()}.xlsx`);
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

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
