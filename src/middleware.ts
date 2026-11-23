import { NextResponse, type NextRequest } from 'next/server';
import { configuredPassword, sessionCookie, validSession } from './lib/auth';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/login') return NextResponse.next();

  const password = configuredPassword();
  if (password && await validSession(request.cookies.get(sessionCookie)?.value, password)) return NextResponse.next();

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: password ? 'Sign in to continue.' : 'The app password is unconfigured.' },
      { status: password ? 401 : 503 });
  }
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
