import { runAudit } from '../../../lib/audit';
import { auditInputSchema } from '../../../lib/audit-input';

export const runtime = 'nodejs';
export const maxDuration = 360;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send a valid JSON request body.' }, { status: 400 });
  }

  const result = auditInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({
      error: 'Invalid audit input.',
      issues: result.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
  }

  return Response.json(await runAudit(result.data));
}
