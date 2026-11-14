'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, Printer, ShieldCheck, XCircle } from 'lucide-react';
import styles from './PaymentDemoPage.module.css';
import { getSupabaseClient } from '../lib/supabase/client';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);

export default function PaymentDemoPage({ paymentId }) {
    const router = useRouter();
    const [payment, setPayment] = useState(null);
    const [accessToken, setAccessToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [now, setNow] = useState(0);

    const loadPayment = useCallback(async (token) => {
        const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load payment.');
        setPayment(result.payment);
        return result.payment;
    }, [paymentId]);

    useEffect(() => {
        let isCurrent = true;
        const load = async () => {
            try {
                setNow(Date.now());
                const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
                if (sessionError) throw sessionError;
                if (!session) {
                    setError('Sign in with the cashier account that created this payment to continue.');
                    return;
                }
                if (isCurrent) setAccessToken(session.access_token);
                await loadPayment(session.access_token);
            } catch (loadError) {
                if (isCurrent) setError(loadError.message || 'Unable to load payment.');
            } finally {
                if (isCurrent) setLoading(false);
            }
        };
        load();
        return () => { isCurrent = false; };
    }, [loadPayment]);

    useEffect(() => {
        if (!payment || payment.status !== 'pending') return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        const poller = window.setInterval(() => loadPayment(accessToken).catch((pollError) => setError(pollError.message)), 5000);
        return () => {
            window.clearInterval(timer);
            window.clearInterval(poller);
        };
    }, [accessToken, loadPayment, payment]);

    const remaining = payment?.expires_at
        ? Math.max(0, Math.ceil((new Date(payment.expires_at).getTime() - now) / 1000))
        : 0;
    const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

    const confirmPayment = async () => {
        if (!accessToken || processing || payment?.status !== 'pending') return;
        setProcessing(true);
        setError('');
        try {
            const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/confirm`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to confirm this payment.');
            if (result.result?.status === 'failed') setError(result.result.failure_reason || 'The simulated payment failed.');
            await loadPayment(accessToken);
        } catch (confirmError) {
            setError(confirmError.message || 'Network error. Refresh to check the latest payment status.');
        } finally {
            setProcessing(false);
        }
    };

    const cancelPayment = async () => {
        if (!accessToken || processing) return;
        setProcessing(true);
        setError('');
        try {
            const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to cancel payment.');
            await loadPayment(accessToken);
        } catch (cancelError) {
            setError(cancelError.message);
        } finally {
            setProcessing(false);
        }
    };

    const isPaid = payment?.status === 'paid_simulated';
    const isFailed = ['failed', 'canceled', 'expired'].includes(payment?.status);
    const isWrongMethod = payment && payment.payment_method !== 'qrph';

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <Link href="/dashboard" aria-label="Back to dashboard"><ArrowLeft size={18} /> Dashboard</Link>
                <span><ShieldCheck size={15} /> TEST MODE</span>
            </header>
            <section className={styles.panel}>
                <p className={styles.eyebrow}>PREDICTPOS · QRPH DEMO</p>
                <h1>{isPaid ? 'Payment confirmed' : isFailed ? 'Payment not completed' : 'Confirm QRPH payment'}</h1>
                <p className={styles.disclosure}>DEMO TRANSACTION · NO REAL MONEY WILL BE TRANSFERRED</p>

                {loading ? <p className={styles.message}>Loading payment status…</p> : error && !payment ? <div className={styles.error} role="alert">{error}</div> : null}
                {!loading && payment && isWrongMethod && <div className={styles.error} role="alert">This internal link is not a QRPH payment.</div>}
                {!loading && payment && !isWrongMethod && (
                    <>
                        <div className={styles.amount}><span>Amount due</span><strong>{money(payment.amount)}</strong></div>
                        <dl className={styles.details}>
                            <div><dt>Reference</dt><dd>{payment.transaction_reference}</dd></div>
                            <div><dt>Method</dt><dd>QRPH · Simulated</dd></div>
                            <div><dt>Status</dt><dd>{isPaid ? 'Paid (Simulated)' : payment.status}</dd></div>
                        </dl>
                        {payment.status === 'pending' && (
                            <>
                                <p className={styles.countdown}><Clock3 size={16} /> Expires in <strong>{countdown}</strong></p>
                                {remaining === 0 && <p className={styles.message}>This QR payment has expired.</p>}
                                <button className={styles.primaryButton} type="button" onClick={confirmPayment} disabled={processing || remaining === 0}>
                                    {processing ? 'Processing…' : 'Simulate Payment'}
                                </button>
                                <button className={styles.cancelButton} type="button" onClick={cancelPayment} disabled={processing}>Cancel payment</button>
                            </>
                        )}
                        {isPaid && (
                            <section className={styles.receipt}>
                                <h2><CheckCircle2 size={19} /> Simulated receipt</h2>
                                <p className={styles.warning}>DEMO TRANSACTION — NO REAL MONEY WAS TRANSFERRED.</p>
                                <dl className={styles.details}>
                                    <div><dt>Receipt</dt><dd>{payment.receipt_number || '—'}</dd></div>
                                    <div><dt>Transaction date</dt><dd>{new Date(payment.completed_at || payment.created_at).toLocaleString()}</dd></div>
                                    <div><dt>Amount</dt><dd>{money(payment.amount)}</dd></div>
                                </dl>
                                <button className={styles.secondaryButton} type="button" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>
                            </section>
                        )}
                        {isFailed && <p className={styles.error}><XCircle size={16} /> {payment.failure_reason || `Payment ${payment.status}.`}</p>}
                    </>
                )}
                {error && payment && <p className={styles.error} role="alert">{error}</p>}
                {!accessToken && !loading && <button className={styles.secondaryButton} type="button" onClick={() => router.push('/')}>Sign in</button>}
            </section>
        </main>
    );
}