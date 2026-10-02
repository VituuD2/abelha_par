import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import {
  report,
  analyticsError,
  analyticsStatus,
} from "@/lib/analytics/server";
import {
  csvCell,
  exportMetadata,
  exportRow,
  EXPORT_COLUMNS,
} from "@/lib/analytics/export";
import type { ABCResult } from "@/lib/analytics/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const b = await request.json(),
      filters = parseABCFilters(b.filters);
    if (!["csv", "xlsx"].includes(b.format))
      throw new Error("Formato inválido.");
    // One SQL statement gives all ranked entities a single MVCC snapshot. Never export only the visible page.
    const [result, status] = await Promise.all([
      report(auth.access, filters, 0, -1, "rank", "asc") as Promise<ABCResult>,
      analyticsStatus(auth.access.workspaceId, auth.access.user.id),
    ]);
    const metadata = [
      ...exportMetadata(filters, result),
      ["Empresas / conexões / cobertura", JSON.stringify(status)],
    ];
    const name = `curva-abc-${filters.from}-${filters.to}.${b.format}`;
    if (b.format === "xlsx") {
      if (result.total > 50000)
        throw new Error(
          "Este relatório excede 50 mil entidades. Use CSV para exportar todas.",
        );
      const XLSX = await import("xlsx"),
        book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          EXPORT_COLUMNS,
          ...result.rows.map(exportRow),
        ]),
        "Curva ABC",
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet(metadata),
        "Escopo",
      );
      return new Response(
        XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${name}"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const encoder = new TextEncoder();
    let index = -metadata.length - 1;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < -1)
          controller.enqueue(
            encoder.encode(
              (index === -metadata.length - 1 ? "\ufeff" : "") +
                metadata[index + metadata.length + 1].map(csvCell).join(";") +
                "\r\n",
            ),
          );
        else if (index === -1)
          controller.enqueue(
            encoder.encode(EXPORT_COLUMNS.map(csvCell).join(";") + "\r\n"),
          );
        else if (index < result.rows.length)
          controller.enqueue(
            encoder.encode(
              exportRow(result.rows[index]).map(csvCell).join(";") + "\r\n",
            ),
          );
        else {
          controller.close();
          return;
        }
        index++;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return analyticsError(e);
  }
}
