import { authenticatePaymentRequest } from '../../../../../lib/payments/server';

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request, { params }) {
    try {
        const auth = await authenticatePaymentRequest(request, ['cashier']);
        if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
        const { paymentId } = await params;
        if (!uuidPattern.test(paymentId)) return Response.json({ error: 'Invalid payment ID.' }, { status: 400 });

        const { data: payment, error: paymentError } = await auth.supabase
            .from('simulated_payments')
            .update({ status: 'canceled', completed_at: new Date().toISOString(), failure_reason: 'Canceled by cashier.' })
            .eq('id', paymentId)
            .eq('user_id', auth.user.id)
            .eq('status', 'pending')
            .select('id, status, transaction_reference')
            .maybeSingle();
        if (paymentError) throw paymentError;
        if (!payment) return Response.json({ error: 'Only a pending payment can be canceled.' }, { status: 409 });

        return Response.json({ payment });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to cancel this payment.' }, { status: 500 });
    }
}