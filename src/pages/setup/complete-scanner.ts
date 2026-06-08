import type { APIRoute } from 'astro';
import { completeStep, SetupStep } from '../../lib/setup';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const session = locals.user;
  if (!session) return redirect('/app/login');

  const form = await request.formData();
  const action = form.get('action') as string;

  await completeStep(SetupStep.Scanner, {
    skipped: action === 'skip',
    ranAt: new Date().toISOString(),
  });

  return redirect('/setup/complete');
};
