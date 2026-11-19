import { handleOwnerSignup } from '../../../../lib/signup/server';

export const runtime = 'nodejs';

export async function GET() {
    return Response.json({ enabled: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
    return handleOwnerSignup(request);
}
