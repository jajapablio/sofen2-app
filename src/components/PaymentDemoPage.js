'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import styles from './PaymentDemoPage.module.css';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

export default function PaymentDemoPage({ paymentId }) {
    const [payment, setPayment] = useState(null);
    const [processing, setProcessing] = useState(true);
    const [error, setError] = useState('');
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let timer;
        const run = async () => {
            setProcessing(true);
            setError('');
            try {
                const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
                if (!token) throw new Error('This payment link is incomplete. Scan a new QR code from the cashier.');
                const options = { headers: { 'X-Payment-Token': token }, cache: 'no-store', signal: controller.signal };
                const endpoint = `/api/qr-payments/${encodeURIComponent(paymentId)}`;
                const read = async () => {
                    const response = await fetch(endpoint, options);
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Unable to load payment.');
                    return result.payment;
                };
                let current = await read();
                if (controller.signal.aborted) return;
                setPayment(current);
                if (current.status === 'pending') {
                    await new Promise((resolve) => { timer = window.setTimeout(resolve, 900); });
                    if (controller.signal.aborted) return;
                    const response = await fetch(endpoint, { ...options, method: 'POST' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Unable to confirm payment.');
                    current = await read();
                    if (controller.signal.aborted) return;
                    setPayment(current);
                }
                if (current.status !== 'paid_simulated') throw new Error(current.failure_reason || `Payment ${current.status}. Ask the cashier for assistance.`);
            } catch (failure) {
                if (!controller.signal.aborted) setError(failure.message || 'Unable to confirm payment.');
            } finally {
                if (!controller.signal.aborted) setProcessing(false);
            }
        };
        run();
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [paymentId, retryKey]);

    const paid = payment?.status === 'paid_simulated';
    return (
        <main className={styles.page}>
            <section className={styles.panel}>
                <p className={styles.eyebrow}>PREDICTPOS · QRPH</p>
                <h1>{paid ? 'Payment successful' : processing ? 'Processing payment…' : 'Payment not completed'}</h1>
                <p className={styles.disclosure}>Test mode · No real money is transferred</p>
                {processing && <p className={styles.message} role="status"><Clock3 size={18} /> Please wait while we confirm your payment.</p>}
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
                    <p className={styles.warning}>Test receipt</p>
                    <dl className={styles.details}>
                        <div><dt>Receipt</dt><dd>{payment.receipt_number || '—'}</dd></div>
                        <div><dt>Transaction date</dt><dd>{new Date(payment.completed_at || payment.created_at).toLocaleString()}</dd></div>
                    </dl>
                    <p className={styles.message}>Payment confirmed. You can close this page.</p>
                </section>}
                {!processing && !paid && <button type="button" className={styles.primaryButton} onClick={() => setRetryKey((key) => key + 1)}>Check payment again</button>}
            </section>
        </main>
    );
}
