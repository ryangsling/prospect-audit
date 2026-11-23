import { BatchInputError, makeBatchZip, maxCsvBytes, parseLeads } from '../../../../lib/batch';

export const runtime = 'nodejs';
export const maxDuration = 800;
const deadline = 765_000;

async function boundedBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > max) {
          await reader.cancel();
          throw new BatchInputError('CSV files must be 128 KiB or smaller.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks, bytes);
}

async function uploadedCsv(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const body = new Uint8Array(await boundedBody(request, maxCsvBytes + 16_384));
    const data = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
    const file = data.get('file');
    if (!file || typeof file === 'string') throw new BatchInputError('Choose a CSV file to upload.');
    if (file.size > maxCsvBytes) throw new BatchInputError('CSV files must be 128 KiB or smaller.');
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  }
  if (/^(?:text\/csv|application\/csv)\b/i.test(contentType)) {
    return new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(request, maxCsvBytes));
  }
  throw new BatchInputError('Upload a CSV file or send the file as text/csv.');
}

export async function POST(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadline)]);
  let leads;
  try {
    leads = parseLeads(await uploadedCsv(request));
  } catch (error) {
    return Response.json({ error: error instanceof BatchInputError ? error.message : 'The CSV could not be read.' }, { status: 400 });
  }
  const zip = await makeBatchZip(leads, signal);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="audit-batch-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
