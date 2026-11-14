'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import styles from './PaymentDemoPage.module.css';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

export default function PaymentDemoPage({ paymentId }) {
    const [payment, setPayment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState('');
    const [error, setError] = useState('');
    const [now, setNow] = useState(0);
    const endpoint = `/api/qr-payments/${encodeURIComponent(paymentId)}`;
    const requestPayment = useCallback(async (method = 'GET', signal) => {
        const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
        if (!token) throw new Error('This payment link is incomplete. Scan a new QR code from the cashier.');
        const response = await fetch(endpoint, { method, headers: { 'X-Payment-Token': token }, cache: 'no-store', signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to update payment.');
        return result;
    }, [endpoint]);

    const checkPayment = useCallback(async () => {
        try {
            const result = await requestPayment();
            setPayment(result.payment);
            setError('');
            setNow(Date.now());
        } catch (failure) { setError(failure.message); }
    }, [requestPayment]);

    useEffect(() => {
        const controller = new AbortController();
        requestPayment('GET', controller.signal).then((result) => {
            if (!controller.signal.aborted) { setPayment(result.payment); setNow(Date.now()); }
        }).catch((failure) => {
            if (!controller.signal.aborted) setError(failure.message);
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [requestPayment]);

    useEffect(() => {
        if (payment?.status !== 'pending') return;
        const clock = window.setInterval(() => setNow(Date.now()), 1000);
        const poller = window.setInterval(checkPayment, 5000);
        return () => { window.clearInterval(clock); window.clearInterval(poller); };
    }, [payment?.status, checkPayment]);

    const performAction = async (action) => {
        if (processing || payment?.status !== 'pending') return;
        setProcessing(action);
        setError('');
        try {
            const result = await requestPayment(action === 'cancel' ? 'DELETE' : 'POST');
            if (result.payment) setPayment(result.payment);
            else {
                const latest = await requestPayment();
                setPayment(latest.payment);
                if (latest.payment.status !== 'paid_simulated') setError(latest.payment.failure_reason || `Payment ${latest.payment.status}.`);
            }
        } catch (failure) {
            try { const latest = await requestPayment(); setPayment(latest.payment); } catch { /* Keep the original action error. */ }
            setError(failure.message || 'Unable to update payment.');
        } finally { setProcessing(''); }
    };
    const expired = payment?.status === 'pending' && new Date(payment.expires_at).getTime() <= now;
    const pending = payment?.status === 'pending' && !expired;
    const canceled = payment?.status === 'canceled';
    const paid = payment?.status === 'paid_simulated';
    return (
        <main className={styles.page}>
            <section className={styles.panel}>
                <p className={styles.eyebrow}>PREDICTPOS · QRPH</p>
                <h1>{paid ? 'Payment successful' : canceled ? 'Payment canceled' : loading ? 'Loading payment…' : processing === 'pay' ? 'Processing payment…' : processing === 'cancel' ? 'Canceling payment…' : pending ? 'Confirm QRPH payment' : 'Payment not completed'}</h1>
                {processing && <p className={styles.message} role="status"><Clock3 size={18} /> Please wait while we update your payment.</p>}
                {error && <div className={styles.error} role="alert">{error}</div>}
                {payment && <>
                    <div className={styles.amount}><span>{paid ? 'Amount paid' : 'Amount due'}</span><strong>{money(payment.amount)}</strong></div>
                    <dl className={styles.details}>
                        <div><dt>Reference</dt><dd>{payment.transaction_reference}</dd></div>
                        <div><dt>Method</dt><dd>QRPH</dd></div>
                        <div><dt>Status</dt><dd>{paid ? 'Paid' : payment.status}</dd></div>
                    </dl>
                </>}
                {paid && <section className={styles.receipt}>
                    <h2><CheckCircle2 size={19} /> Payment receipt</h2>
                    <dl className={styles.details}>
                        <div><dt>Receipt</dt><dd>{payment.receipt_number || '—'}</dd></div>
                        <div><dt>Transaction date</dt><dd>{new Date(payment.completed_at || payment.created_at).toLocaleString()}</dd></div>
                    </dl>
                    <p className={styles.message}>Payment confirmed. You can close this page.</p>
                </section>}
                {pending && <div className={styles.paymentActions}>
                    <button type="button" className={styles.primaryButton} disabled={Boolean(processing)} onClick={() => performAction('pay')}>{processing === 'pay' ? 'Processing…' : 'Pay now'}</button>
                    <button type="button" className={styles.cancelButton} disabled={Boolean(processing)} onClick={() => performAction('cancel')}>{processing === 'cancel' ? 'Canceling…' : 'Cancel payment'}</button>
                </div>}
                {expired && <p className={styles.message}>This QR code has expired. Ask the cashier for a new payment.</p>}
                {canceled && <p className={styles.message}>Payment canceled. No sale was completed.</p>}
                {!loading && !processing && error && <button type="button" className={styles.cancelButton} onClick={checkPayment}>Check payment again</button>}
            </section>
        </main>
    );
}
