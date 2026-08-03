import * as XLSX from "xlsx";
import { normalizeOrderId } from "@/lib/order-id";

/**
 * Parses a Yampi spreadsheet (.xlsx or .csv) and extracts all IDs from the correct column.
 * It searches for the 'numero_pedido' column dynamically.
 * Returns a Set of unique Yampi ID strings.
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
  
  if (rows.length < 2) return yampiIds; // Empty or just header

  // Find the correct column for the order number
  const headers = (rows[0] as string[]).map(h => String(h).toLowerCase().trim());
  let orderNumberColIndex = headers.indexOf("numero_pedido");
  
  // Fallback to first column if 'numero_pedido' header is not found
  if (orderNumberColIndex === -1) {
    orderNumberColIndex = 0;
  }

  // Skip header row (index 0), extract order numbers
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[orderNumberColIndex] !== undefined && row[orderNumberColIndex] !== null && row[orderNumberColIndex] !== "") {
      const orderId = normalizeOrderId(row[orderNumberColIndex]);
      if (orderId) {
        yampiIds.add(orderId);
      }
    }
  }

  return yampiIds;
}

/**
 * Gets the total count from the spreadsheet, accurately reflecting unique orders.
 */
export function getSpreadsheetInfo(buffer: ArrayBuffer): { totalRows: number; headers: string[]; yampiIds: Set<string> } {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const headers = rows[0] ? rows[0].map(String) : [];
  
  const yampiIds = new Set<string>();
  const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());
  const orderNumberColumn = normalizedHeaders.indexOf("numero_pedido");
  if (orderNumberColumn === -1) {
    throw new Error("A coluna obrigatória numero_pedido não foi encontrada.");
  }
  for (const row of rows.slice(1)) {
    const value = row[orderNumberColumn];
    const orderId = normalizeOrderId(value);
    if (orderId) yampiIds.add(orderId);
  }

  return {
    totalRows: yampiIds.size,
    headers,
    yampiIds,
  };
}
