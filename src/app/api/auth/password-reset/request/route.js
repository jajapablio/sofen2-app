import { handleReset } from '../../../../../lib/password-reset/server';

export const runtime = 'nodejs';

export async function POST(request) {
    return handleReset(request, 'request');
}
