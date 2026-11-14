import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { verifyQrToken } from '../../../../lib/payments/qr-token';

const fields = 'id, transaction_reference, payment_method, amount, currency, status, receipt_number, failure_reason, created_at, expires_at, completed_at';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const reply = (body, status = 200) => Response.json(body, { status, headers });

async function load(request, params) {
    const { paymentId } = await params;
    if (!verifyQrToken(request.headers.get('x-payment-token'), paymentId)) return { response: reply({ error: 'This payment link is invalid or expired. Ask the cashier for a new QR code.' }, 403) };
    const supabase = getSupabaseAdminClient();
    const { data: payment, error } = await supabase.from('simulated_payments').select(fields).eq('id', paymentId).eq('payment_method', 'qrph').maybeSingle();
    if (error) throw error;
    if (!payment) return { response: reply({ error: 'Payment not found.' }, 404) };
    if (new Date(payment.expires_at).getTime() <= Date.now() && payment.status === 'pending') return { response: reply({ error: 'This payment has expired.' }, 410) };
    return { supabase, payment };
}

export async function GET(request, { params }) {
    try {
        const context = await load(request, params);
        return context.response || reply({ payment: context.payment });
    } catch { return reply({ error: 'Unable to load payment.' }, 500); }
}

export async function POST(request, { params }) {
    try {
        const context = await load(request, params);
        if (context.response) return context.response;
        const { data: result, error } = await context.supabase.rpc('confirm_qr_demo_payment', { p_payment_id: context.payment.id });
        if (error) return reply({ error: 'Unable to confirm this payment. Ask the cashier to check its status.' }, 409);
        return reply({ result });
    } catch { return reply({ error: 'Unable to confirm payment.' }, 500); }
}

export async function DELETE(request, { params }) {
    try {
        const context = await load(request, params);
        if (context.response) return context.response;
        const { data: payment, error } = await context.supabase.from('simulated_payments')
            .update({ status: 'canceled', completed_at: new Date().toISOString(), failure_reason: 'Canceled from QR payment page.' })
            .eq('id', context.payment.id).eq('payment_method', 'qrph').eq('status', 'pending')
            .select(fields).maybeSingle();
        if (error) throw error;
        if (!payment) return reply({ error: 'Only a pending payment can be canceled. Check its latest status.' }, 409);
        return reply({ payment });
    } catch { return reply({ error: 'Unable to cancel payment.' }, 500); }
}
