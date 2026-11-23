'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionCookie } from '../lib/auth';

export async function signOut() {
  (await cookies()).delete(sessionCookie);
  redirect('/login');
}
