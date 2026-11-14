import { authenticatePaymentRequest } from '../../../../lib/payments/server';

const statuses = new Set(['pending', 'processing', 'paid_simulated', 'failed', 'canceled', 'expired']);
const methods = new Set(['cash', 'qrph', 'card']);
const pageSize = 50;

export async function GET(request) {
    try {
        const auth = await authenticatePaymentRequest(request, ['admin']);
        if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
        if (!auth.profile.store_id) return Response.json({ error: 'Your administrator account is not assigned to a store.' }, { status: 403 });

        const searchParams = new URL(request.url).searchParams;
        const page = Math.max(1, Math.min(10000, Number.parseInt(searchParams.get('page') || '1', 10) || 1));
        let query = auth.supabase
            .from('simulated_payments')
            .select('id, transaction_reference, payment_method, amount, currency, status, receipt_number, failure_reason, created_at, expires_at, completed_at', { count: 'exact' })
            .eq('store_id', auth.profile.store_id)
            .order('created_at', { ascending: false });

        const status = searchParams.get('status') || '';
        const method = searchParams.get('method') || '';
        const reference = (searchParams.get('reference') || '').trim().slice(0, 40);
        const dateFrom = searchParams.get('from') || '';
        const dateTo = searchParams.get('to') || '';
        const exportAll = searchParams.get('export') === 'true';
        if (status && statuses.has(status)) query = query.eq('status', status);
        if (method && methods.has(method)) query = query.eq('payment_method', method);
        if (reference) query = query.ilike('transaction_reference', `%${reference}%`);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) query = query.gte('created_at', `${dateFrom}T00:00:00+08:00`);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
            const end = new Date(`${dateTo}T00:00:00+08:00`);
            if (!Number.isNaN(end.getTime())) {
                end.setUTCDate(end.getUTCDate() + 1);
                query = query.lt('created_at', end.toISOString());
            }
        }
        query = exportAll ? query.limit(5000) : query.range((page - 1) * pageSize, page * pageSize - 1);

        const [{ data: payments, error: paymentError, count }, { data: metrics, error: metricsError }] = await Promise.all([
            query,
            auth.supabase.rpc('admin_simulated_payment_metrics', { p_store_id: auth.profile.store_id }),
        ]);
        if (paymentError) throw paymentError;
        if (metricsError) throw metricsError;

        return Response.json({ payments: payments || [], metrics: metrics || {}, count: count || 0, page, pageSize, truncated: exportAll && (count || 0) > 5000 });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to load simulated payments.' }, { status: 500 });
    }
}