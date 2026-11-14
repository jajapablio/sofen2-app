import { createQrToken } from '../../../../lib/payments/qr-token';
import { authenticatePaymentRequest } from '../../../../lib/payments/server';

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const paymentFields = 'id, transaction_reference, payment_method, amount, currency, status, sale_id, receipt_number, failure_reason, created_at, expires_at, completed_at';

export async function GET(request, { params }) {
    try {
        const auth = await authenticatePaymentRequest(request, ['cashier']);
        if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
        const { paymentId } = await params;
        if (!uuidPattern.test(paymentId)) return Response.json({ error: 'Invalid payment ID.' }, { status: 400 });

        const { data: payment, error: paymentError } = await auth.supabase
            .from('simulated_payments')
            .select(paymentFields)
            .eq('id', paymentId)
            .eq('user_id', auth.user.id)
            .maybeSingle();
        if (paymentError) throw paymentError;
        if (!payment) return Response.json({ error: 'Payment not found.' }, { status: 404 });

        if (payment.status === 'pending' && new Date(payment.expires_at) <= new Date()) {
            const { data: expired, error: expireError } = await auth.supabase
                .from('simulated_payments')
                .update({ status: 'expired', completed_at: new Date().toISOString(), failure_reason: 'Payment expired.' })
                .eq('id', payment.id)
                .eq('user_id', auth.user.id)
                .eq('status', 'pending')
                .select(paymentFields)
                .maybeSingle();
            if (expireError) throw expireError;
            return Response.json({ payment: expired || { ...payment, status: 'expired' } });
        }

        return Response.json({ payment: { ...payment, qr_token: payment.payment_method === 'qrph' ? createQrToken(payment) : undefined } });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to load payment status.' }, { status: 500 });
    }
}