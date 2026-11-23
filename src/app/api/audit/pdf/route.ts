import { pdfInputSchema } from '../../../../lib/pdf/input';
import { pdfFilename, renderAuditPdf } from '../../../../lib/pdf/report';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = pdfInputSchema.safeParse(body);
  if (!result.success) return Response.json({ error: 'Send a valid audit with its revenue assumptions.' }, { status: 400 });
  const buffer = await renderAuditPdf(result.data);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFilename(result.data)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
