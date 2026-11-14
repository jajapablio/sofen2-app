import { createClient } from '@supabase/supabase-js';
import { authenticatePaymentRequest } from '../../../../../lib/payments/server';

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request, { params }) {
    try {
        const auth = await authenticatePaymentRequest(request, ['cashier']);
        if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
        const { paymentId } = await params;
        if (!uuidPattern.test(paymentId)) return Response.json({ error: 'Invalid payment ID.' }, { status: 400 });

        let body = {};
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: 'Provide a valid confirmation request.' }, { status: 400 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) throw new Error('Supabase is not configured.');

        const userClient = createClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
        });
        const { data: result, error: confirmError } = await userClient.rpc('confirm_simulated_payment', {
            p_payment_id: paymentId,
            p_test_card_identifier: typeof body.testCardIdentifier === 'string'
                ? body.testCardIdentifier.trim()
                : null,
        });
        if (confirmError) {
            const isUnavailable = /not found|not available/i.test(confirmError.message || '');
            return Response.json({ error: confirmError.message || 'Unable to confirm this payment.' }, { status: isUnavailable ? 404 : 409 });
        }

        return Response.json({ result });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to confirm this simulated payment.' }, { status: 500 });
    }
}