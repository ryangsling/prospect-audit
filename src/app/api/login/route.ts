import { NextResponse, type NextRequest } from 'next/server';
import { configuredPassword, createSession, passwordMatches, sessionCookie, sessionSeconds } from '../../../lib/auth';

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const password = configuredPassword();
  if (!password) return redirect('/login');
  // Browser form logins originate from this app, including when changing an existing session.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && origin !== request.nextUrl.origin && origin !== `${request.nextUrl.protocol}//${host}`) {
    return NextResponse.json({ error: 'Invalid login origin.' }, { status: 403 });
  }

  let submitted: FormDataEntryValue | null;
  try {
    submitted = (await request.formData()).get('password');
  } catch {
    submitted = null;
  }
  if (typeof submitted !== 'string' || submitted.length > 1024 || !await passwordMatches(submitted, password)) {
    return redirect('/login?invalid=1');
  }

  const response = redirect('/');
  response.cookies.set(sessionCookie, await createSession(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: sessionSeconds,
  });
  return response;
}
