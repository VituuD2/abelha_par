import * as XLSX from "xlsx";

/**
 * Parses a Yampi spreadsheet (.xlsx or .csv) and extracts all IDs from the first column.
 * Returns a Set of Yampi ID strings for O(1) lookups during cross-referencing.
 */
export function parseYampiSpreadsheet(buffer: ArrayBuffer): Set<string> {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  
  // Convert to JSON - header:1 returns arrays
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1, // Use array format (row[0], row[1], etc.)
    defval: "",
  }) as unknown as unknown[][];

  const yampiIds = new Set<string>();

  // Skip header row (index 0), extract first column values
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[0] !== undefined && row[0] !== null && row[0] !== "") {
      yampiIds.add(String(row[0]).trim());
    }
  }

  return yampiIds;
}

/**
 * Gets the total count from the spreadsheet
 */
export function getSpreadsheetInfo(buffer: ArrayBuffer): { totalRows: number; headers: string[] } {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const headers = rows[0] ? rows[0].map(String) : [];
  return {
    totalRows: rows.length - 1, // Exclude header
    headers,
  };
}
