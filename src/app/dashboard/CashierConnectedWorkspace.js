'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CreditCard, Printer, QrCode, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getSupabaseClient } from '../../lib/supabase/client';
import './dashboard.css';

const money = (value) => `₱${Number(value || 0).toFixed(2)}`;
const paymentMethods = [
    { value: 'cash', label: 'Cash' },
    { value: 'qrph', label: 'QRPH' },
    { value: 'card', label: 'Card' },
];

export default function CashierConnectedWorkspace() {
    const router = useRouter();
    const [profile, setProfile] = useState(null);
    const [store, setStore] = useState(null);
    const [products, setProducts] = useState([]);
    const [sales, setSales] = useState([]);
    const [cart, setCart] = useState([]);
    const [activeCategory, setActiveCategory] = useState('All');
    const [search, setSearch] = useState('');
    const [discountPercent, setDiscountPercent] = useState('0');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [cashReceived, setCashReceived] = useState('');
    const [idempotencyKey, setIdempotencyKey] = useState('');
    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [paymentRecord, setPaymentRecord] = useState(null);
    const [paymentOutcome, setPaymentOutcome] = useState(null);
    const [paymentError, setPaymentError] = useState('');
    const [testCardIdentifier, setTestCardIdentifier] = useState('TEST-CARD-001');
    const [siteOrigin, setSiteOrigin] = useState('');
    const [qrSeconds, setQrSeconds] = useState(300);
    const [saleToVoid, setSaleToVoid] = useState(null);
    const [voidPin, setVoidPin] = useState('');
    const [voidReason, setVoidReason] = useState('');
    const [voidError, setVoidError] = useState('');
    const [isVoiding, setIsVoiding] = useState(false);
    const [refundSale, setRefundSale] = useState(null);
    const [refundItems, setRefundItems] = useState([]);
    const [refundItemId, setRefundItemId] = useState('');
    const [refundQuantity, setRefundQuantity] = useState('1');
    const [refundPin, setRefundPin] = useState('');
    const [refundReason, setRefundReason] = useState('');
    const [refundError, setRefundError] = useState('');
    const [refundLoading, setRefundLoading] = useState(false);
    const [isRefunding, setIsRefunding] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let isCurrent = true;

        const loadWorkspace = async () => {
            setLoading(true);
            setError('');

            try {
                const supabase = getSupabaseClient();
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                if (authError) throw authError;
                if (!user) {
                    router.replace('/');
                    return;
                }
                setSiteOrigin(window.location.origin);

                const { data: currentProfile, error: profileError } = await supabase
                    .from('profiles')
                    .select('id, full_name, role, store_id, global_access, is_active, permission_overrides')
                    .eq('id', user.id)
                    .maybeSingle();
                if (profileError) throw profileError;
                if (!currentProfile?.is_active) {
                    await supabase.auth.signOut();
                    router.replace('/');
                    return;
                }
                if (currentProfile.role === 'manager' || currentProfile.role === 'admin') {
                    router.replace(currentProfile.role === 'admin'
                        ? '/dashboard/admin'
                        : '/dashboard/manager');
                    return;
                }
                if (!currentProfile.store_id) {
                    throw new Error('Your staff profile is not assigned to a store. Ask an administrator to finish setup.');
                }

                const results = await Promise.all([
                    supabase.from('stores').select('id, name, tax_rate').eq('id', currentProfile.store_id).single(),
                    supabase.from('products')
                        .select('id, sku, name, category, image_url, selling_price, current_stock')
                        .eq('store_id', currentProfile.store_id)
                        .order('name'),
                    supabase.from('sales')
                        .select('id, receipt_number, total_amount, payment_method, created_at')
                        .eq('store_id', currentProfile.store_id)
                        .eq('status', 'completed')
                        .order('created_at', { ascending: false })
                        .limit(20),
                ]);
                const failedResult = results.find((result) => result.error);
                if (failedResult) throw failedResult.error;
                if (!isCurrent) return;

                setProfile(currentProfile);
                setStore(results[0].data);
                setProducts(results[1].data || []);
                setSales(results[2].data || []);
            } catch (loadError) {
                if (isCurrent) setError(loadError.message || 'Unable to load point-of-sale data.');
            } finally {
                if (isCurrent) setLoading(false);
            }
        };

        loadWorkspace();
        return () => { isCurrent = false; };
    }, [reloadKey, router]);

    useEffect(() => {
        if (!paymentRecord || paymentRecord.status !== 'pending' || paymentRecord.payment_method !== 'qrph') return undefined;
        const refreshPayment = async () => {
            try {
                const { data: { session } } = await getSupabaseClient().auth.getSession();
                if (!session) return;
                const response = await fetch(`/api/payments/${encodeURIComponent(paymentRecord.id)}`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                    cache: 'no-store',
                });
                const result = await response.json();
                if (!response.ok || result.payment.status === paymentRecord.status) return;
                setPaymentRecord(result.payment);
                if (result.payment.status === 'paid_simulated') {
                    setPaymentOutcome({
                        status: 'paid_simulated',
                        transaction_reference: result.payment.transaction_reference,
                        amount: result.payment.amount,
                        currency: result.payment.currency,
                        payment_method: result.payment.payment_method,
                        receipt_number: result.payment.receipt_number,
                        completed_at: result.payment.completed_at,
                    });
                    setCart([]);
                    setDiscountPercent('0');
                    setReloadKey((current) => current + 1);
                } else if (result.payment.failure_reason) {
                    setPaymentError(result.payment.failure_reason);
                }
            } catch {
                setPaymentError('Unable to refresh QR payment status. Check your connection.');
            }
        };
        const updateCountdown = async () => {
            const remaining = Math.max(0, Math.ceil((new Date(paymentRecord.expires_at).getTime() - Date.now()) / 1000));
            setQrSeconds(remaining);
            if (remaining === 0) refreshPayment();
        };
        updateCountdown();
        const timer = window.setInterval(updateCountdown, 1000);
        const poller = window.setInterval(refreshPayment, 5000);
        return () => {
            window.clearInterval(timer);
            window.clearInterval(poller);
        };
    }, [paymentRecord]);

    useEffect(() => {
        let isCurrent = true;
        const restorePayment = async () => {
            const paymentId = window.sessionStorage.getItem('predictpos-demo-payment-id');
            if (!paymentId) return;
            try {
                const { data: { session } } = await getSupabaseClient().auth.getSession();
                if (!session) return;
                const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                    cache: 'no-store',
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Unable to restore payment status.');
                if (!isCurrent) return;
                setPaymentRecord(result.payment);
                setPaymentMethod(result.payment.payment_method);
                if (result.payment.status === 'paid_simulated') {
                    setPaymentOutcome({
                        status: 'paid_simulated',
                        transaction_reference: result.payment.transaction_reference,
                        amount: result.payment.amount,
                        currency: result.payment.currency,
                        payment_method: result.payment.payment_method,
                        receipt_number: result.payment.receipt_number,
                        completed_at: result.payment.completed_at,
                    });
                } else if (result.payment.failure_reason) {
                    setPaymentError(result.payment.failure_reason);
                }
                setIsPaymentOpen(true);
            } catch (restoreError) {
                if (isCurrent) setPaymentError(restoreError.message || 'Unable to restore payment status.');
            }
        };
        restorePayment();
        return () => { isCurrent = false; };
    }, []);

    const categories = useMemo(() => [
        'All',
        ...new Set(products.map((product) => product.category).filter(Boolean)),
    ], [products]);
    const filteredProducts = useMemo(() => products.filter((product) => {
        const matchesCategory = activeCategory === 'All' || product.category === activeCategory;
        const query = search.trim().toLowerCase();
        const matchesSearch = !query || `${product.name} ${product.sku}`.toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
    }), [activeCategory, products, search]);
    const subtotal = useMemo(() => cart.reduce(
        (sum, item) => sum + Number(item.selling_price) * item.quantity,
        0
    ), [cart]);
    const discountRate = Number(discountPercent) || 0;
    const discountedSubtotal = useMemo(() => cart.reduce(
        (sum, item) => sum + Math.round((Number(item.selling_price) * item.quantity * (1 - discountRate / 100) + Number.EPSILON) * 100) / 100,
        0
    ), [cart, discountRate]);
    const discountAmount = subtotal - discountedSubtotal;
    const taxRate = Number(store?.tax_rate || 0);
    const tax = Math.round((discountedSubtotal * taxRate + Number.EPSILON) * 100) / 100;
    const total = discountedSubtotal + tax;
    const received = Number(cashReceived) || 0;
    const change = Math.max(0, received - total);
    const selectedRefundItem = refundItems.find((item) => item.id === refundItemId);

    const addToCart = (product) => {
        if (product.current_stock < 1) return;
        const existingItem = cart.find((item) => item.id === product.id);
        if (existingItem?.quantity >= product.current_stock) {
            setNotice(`Only ${product.current_stock} ${product.name} available in stock.`);
            return;
        }
        setNotice('');
        setCart((current) => {
            const existing = current.find((item) => item.id === product.id);
            return existing
                ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
                : [...current, { ...product, quantity: 1 }];
        });
    };

    const updateQuantity = (productId, delta) => {
        setCart((current) => current
            .map((item) => item.id === productId
                ? { ...item, quantity: Math.min(item.current_stock, item.quantity + delta) }
                : item)
            .filter((item) => item.quantity > 0));
    };

    const beginPayment = () => {
        if (!cart.length) return;
        setNotice('');
        setPaymentMethod('cash');
        setCashReceived('');
        setIdempotencyKey(globalThis.crypto.randomUUID());
        setPaymentRecord(null);
        setPaymentOutcome(null);
        setPaymentError('');
        setTestCardIdentifier('TEST-CARD-001');
        setQrSeconds(300);
        window.sessionStorage.removeItem('predictpos-demo-payment-id');
        setIsPaymentOpen(true);
    };

    const recordSale = async () => {
        if (isSubmitting || (!cart.length && paymentRecord?.status !== 'pending')) return;
        if (paymentMethod === 'cash' && received < total) {
            setPaymentError('Cash received must cover the amount due.');
            return;
        }
        if (paymentMethod === 'card' && !['TEST-CARD-001', 'TEST-CARD-002', 'TEST-CARD-003'].includes(testCardIdentifier)) {
            setPaymentError('Choose a test card.');
            return;
        }
        if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
            setPaymentError('Discount must be between 0 and 100 percent.');
            return;
        }
        if (discountRate > 0 && !profile?.permission_overrides?.manual_discounts) {
            setPaymentError('Your account is not authorized to apply a manual discount.');
            return;
        }

        setIsSubmitting(true);
        setPaymentError('');

        try {
            const supabase = getSupabaseClient();
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');
            const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
            let activePayment = paymentRecord;

            if (!activePayment || activePayment.status !== 'pending') {
                const requestKey = !idempotencyKey || activePayment
                    ? globalThis.crypto.randomUUID()
                    : idempotencyKey;
                setIdempotencyKey(requestKey);
                const createResponse = await fetch('/api/payments', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
                        paymentMethod,
                        idempotencyKey: requestKey,
                        discountPercent: discountRate,
                        tenderAmount: paymentMethod === 'cash' ? received : null,
                    }),
                });
                const createResult = await createResponse.json();
                if (!createResponse.ok) throw new Error(createResult.error || 'Unable to start payment.');
                activePayment = createResult.payment;
                window.sessionStorage.setItem('predictpos-demo-payment-id', activePayment.id);
                setPaymentRecord(activePayment);
                if (paymentMethod === 'qrph') return;
            }

            const confirmResponse = await fetch(`/api/payments/${encodeURIComponent(activePayment.id)}/confirm`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ testCardIdentifier: paymentMethod === 'card' ? testCardIdentifier : null }),
            });
            const confirmResult = await confirmResponse.json();
            if (!confirmResponse.ok) throw new Error(confirmResult.error || 'Unable to confirm payment.');
            const outcome = confirmResult.result;
            window.sessionStorage.setItem('predictpos-demo-payment-id', activePayment.id);
            setPaymentOutcome(outcome);
            setPaymentRecord({
                ...activePayment,
                status: outcome.status,
                sale_id: outcome.sale?.id || activePayment.sale_id,
                receipt_number: outcome.receipt_number || outcome.sale?.receipt_number || activePayment.receipt_number,
                completed_at: outcome.completed_at || new Date().toISOString(),
                failure_reason: outcome.failure_reason || null,
            });

            if (outcome.status === 'paid_simulated') {
                setCart([]);
                setDiscountPercent('0');
                setCashReceived('');
                setReloadKey((current) => current + 1);
            } else if (outcome.status === 'failed') {
                setPaymentError(outcome.failure_reason || 'Payment failed.');
            } else if (outcome.status === 'expired') {
                setPaymentError('This payment expired. Start a new payment to continue.');
            }
        } catch (paymentRequestError) {
            setPaymentError(paymentRequestError.message || 'Unable to complete payment.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const cancelPayment = async () => {
        if (!paymentRecord || isSubmitting) return;
        setIsSubmitting(true);
        setPaymentError('');
        try {
            const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');
            const response = await fetch(`/api/payments/${encodeURIComponent(paymentRecord.id)}/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to cancel payment.');
            setPaymentRecord({ ...paymentRecord, status: 'canceled' });
        } catch (cancelError) {
            setPaymentError(cancelError.message || 'Unable to cancel payment.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const beginVoid = (sale) => {
        setSaleToVoid(sale);
        setVoidPin('');
        setVoidReason('');
        setVoidError('');
    };

    const voidSale = async (event) => {
        event.preventDefault();
        if (!saleToVoid || isVoiding) return;

        setIsVoiding(true);
        setVoidError('');
        try {
            const supabase = getSupabaseClient();
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');

            const response = await fetch('/api/cashier/void-sale', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    saleId: saleToVoid.id,
                    pin: voidPin,
                    reason: voidReason,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to void this sale.');

            setNotice(`Sale ${saleToVoid.receipt_number} was voided. Inventory restored. Approved by ${result.approverName}.`);
            setSaleToVoid(null);
            setReloadKey((current) => current + 1);
        } catch (voidRequestError) {
            setVoidError(voidRequestError.message || 'Unable to void this sale.');
        } finally {
            setIsVoiding(false);
        }
    };

    const loadRefundItems = async (saleId) => {
        const supabase = getSupabaseClient();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('Your session expired. Sign in again.');

        const response = await fetch(`/api/cashier/refund-sale?saleId=${encodeURIComponent(saleId)}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load refund items.');
        return result.items || [];
    };

    const beginRefund = async (sale) => {
        setRefundSale(sale);
        setRefundItems([]);
        setRefundItemId('');
        setRefundPin('');
        setRefundReason('');
        setRefundError('');
        setRefundLoading(true);
        try {
            const items = await loadRefundItems(sale.id);
            setRefundItems(items);
            setRefundItemId(items.find((item) => item.remaining_quantity > 0)?.id || '');
        } catch (refundLoadError) {
            setRefundError(refundLoadError.message || 'Unable to load refund items.');
        } finally {
            setRefundLoading(false);
        }
    };

    const submitRefund = async (event) => {
        event.preventDefault();
        if (!refundSale || !selectedRefundItem || isRefunding) return;

        setIsRefunding(true);
        setRefundError('');
        try {
            const supabase = getSupabaseClient();
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');

            const response = await fetch('/api/cashier/refund-sale', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    saleItemId: selectedRefundItem.id,
                    quantity: Number(refundQuantity),
                    pin: refundPin,
                    reason: refundReason,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to refund this item.');

            setNotice(`Refunded ${result.refund.quantity} × ${selectedRefundItem.product_name}. Amount ${money(result.refund.total_amount)}. Approved by ${result.refund.approver_name}.`);
            setRefundPin('');
            setRefundReason('');
            const items = await loadRefundItems(refundSale.id);
            setRefundItems(items);
            setRefundItemId(items.find((item) => item.id === selectedRefundItem.id && item.remaining_quantity > 0)?.id
                || items.find((item) => item.remaining_quantity > 0)?.id
                || '');
            setRefundQuantity('1');
            setReloadKey((current) => current + 1);
        } catch (refundRequestError) {
            setRefundError(refundRequestError.message || 'Unable to refund this item.');
        } finally {
            setIsRefunding(false);
        }
    };

    const logout = async () => {
        try {
            await getSupabaseClient().auth.signOut();
        } finally {
            router.replace('/');
        }
    };

    return (
        <main className="workspace">
            <section className="products">
                <header className="header">
                    <div>
                        <p className="eyebrow">PREDICTPOS · CASHIER</p>
                        <h1>Point of sale</h1>
                    </div>
                    <div className="headerActions">
                        {store && <span className="connection online"><span />{store.name}</span>}
                        <span className="cashierInfo">{profile?.full_name || 'Cashier'}</span>
                        <button className="iconButton" type="button" onClick={logout}>
                            <i className="fas fa-sign-out-alt" aria-hidden="true" /> Log out
                        </button>
                    </div>
                </header>

                <div className="systemNote">
                    <i className="fas fa-database" aria-hidden="true" />
                    Catalog and sales are connected to your Supabase store. Tax rate: {(taxRate * 100).toFixed(2)}%.
                </div>
                {error && <div className="systemNote errorNote" role="alert">{error}</div>}
                {notice && <div className="systemNote noticeNote" role="status">{notice}</div>}

                <div className="toolRow">
                    <form className="searchForm" onSubmit={(event) => event.preventDefault()}>
                        <i className="fas fa-search" aria-hidden="true" />
                        <input
                            aria-label="Search products"
                            placeholder="Search by product name or SKU"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </form>
                    <button className="utilityButton" type="button" onClick={() => setReloadKey((current) => current + 1)} disabled={loading}>
                        <i className="fas fa-sync-alt" aria-hidden="true" /> Refresh catalog
                    </button>
                </div>

                <nav className="categories" aria-label="Product categories">
                    {categories.map((category) => (
                        <button
                            key={category}
                            type="button"
                            className={activeCategory === category ? 'activeCategory' : ''}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                        </button>
                    ))}
                </nav>

                <div className="productGrid" aria-busy={loading}>
                    {loading ? (
                        <div className="noProducts">Loading store catalog…</div>
                    ) : filteredProducts.map((product) => (
                        <button
                            key={product.id}
                            className="productCard"
                            type="button"
                            onClick={() => addToCart(product)}
                            disabled={product.current_stock < 1}
                        >
                            <span className="productIcon">{product.image_url ? <Image src={product.image_url} alt="" width={110} height={74} unoptimized className="productPhoto" /> : <i className="fas fa-box" aria-hidden="true" />}</span>
                            <span className="productName">{product.name}</span>
                            <span className="productSku">{product.sku} · {product.current_stock} in stock</span>
                            <span className="productPrice">{money(product.selling_price)}</span>
                        </button>
                    ))}
                    {!loading && filteredProducts.length === 0 && (
                        <div className="noProducts">
                            {products.length ? 'No products match this search.' : 'No products have been added to this store yet.'}
                        </div>
                    )}
                </div>

                <section className="recentSales" aria-label="Recent completed sales">
                    <h2>Recent sales</h2>
                    {sales.length ? sales.slice(0, 5).map((sale) => (
                        <div className="recentSaleRow" key={sale.id}>
                            <div><strong>{sale.receipt_number}</strong><span>{new Date(sale.created_at).toLocaleString()}</span></div>
                            <span>{sale.payment_method === 'mobile_wallet' ? 'QRPH' : sale.payment_method.replaceAll('_', ' ')}</span>
                            <strong>{money(sale.total_amount)}</strong>
                            <button className="refundSaleButton" type="button" onClick={() => beginRefund(sale)} aria-label={`Refund items from sale ${sale.receipt_number}`}>Refund items</button>
                            <button className="voidSaleButton" type="button" onClick={() => beginVoid(sale)} aria-label={`Void sale ${sale.receipt_number}`}>Void</button>
                        </div>
                    )) : <p className="emptyRecentSales">No completed sales have been recorded.</p>}
                </section>
            </section>

            <aside className="order">
                <div className="orderHeader">
                    <div>
                        <p className="eyebrow">ACTIVE SALE</p>
                        <h2>Current order <span>{cart.reduce((count, item) => count + item.quantity, 0)}</span></h2>
                    </div>
                    <button className="textButton" type="button" onClick={() => setCart([])} disabled={!cart.length}>Clear</button>
                </div>

                <div className="cartList">
                    {!cart.length ? (
                        <div className="emptyCart">
                            <i className="fas fa-shopping-basket" aria-hidden="true" />
                            <strong>Your order is empty</strong>
                            <span>Choose an in-stock product to begin.</span>
                        </div>
                    ) : cart.map((item) => (
                        <article key={item.id} className="cartItem">
                            <div className="cartItemHeading">
                                <div><strong>{item.name}</strong><small>{item.sku}</small></div>
                                <strong>{money(Number(item.selling_price) * item.quantity)}</strong>
                            </div>
                            <div className="cartItemActions">
                                <div className="quantity">
                                    <button type="button" onClick={() => updateQuantity(item.id, -1)} aria-label={`Decrease ${item.name}`}>−</button>
                                    <span>{item.quantity}</span>
                                    <button type="button" onClick={() => updateQuantity(item.id, 1)} aria-label={`Increase ${item.name}`} disabled={item.quantity >= item.current_stock}>+</button>
                                </div>
                                <button className="removeAction" type="button" onClick={() => setCart((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.name}`}>
                                    <i className="fas fa-trash-alt" aria-hidden="true" />
                                </button>
                            </div>
                        </article>
                    ))}
                </div>

                <div className="totals">
                    <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                    {discountRate > 0 && <div className="discountTotal"><span>Discount ({discountRate}%)</span><strong>−{money(discountAmount)}</strong></div>}
                    <div><span>Tax ({(taxRate * 100).toFixed(2)}%)</span><strong>{money(tax)}</strong></div>
                    <div className="grandTotal"><span>Total due</span><strong>{money(total)}</strong></div>
                </div>
                {profile?.permission_overrides?.manual_discounts && (
                    <label className="discountField">
                        <span>Discount (%)</span>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={discountPercent}
                            onChange={(event) => {
                                const value = event.target.value;
                                if (value === '' || (/^\d{0,3}(?:\.\d{0,2})?$/.test(value) && Number(value) <= 100)) {
                                    setDiscountPercent(value);
                                }
                            }}
                            aria-label="Manual discount percentage"
                        />
                    </label>
                )}

                <div className="checkoutActions">
                    <button className="checkoutButton" type="button" onClick={beginPayment} disabled={!cart.length || loading}>
                        <i className="fas fa-credit-card" aria-hidden="true" /> Record payment
                    </button>
                </div>
                <p className="paymentDisclosure"><ShieldCheck size={13} /> Test mode</p>
            </aside>

            {isPaymentOpen && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && paymentRecord?.status !== 'pending' && setIsPaymentOpen(false)}>
                    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
                        <div className="dialogHeader">
                            <div><p className="eyebrow">Test mode</p><h2 id="payment-title">Checkout</h2></div>
                            <button type="button" onClick={() => setIsPaymentOpen(false)} aria-label="Close" disabled={isSubmitting || paymentRecord?.status === 'pending'}>×</button>
                        </div>
                        <div className="dialogBody">
                            {paymentOutcome?.status === 'paid_simulated' ? (
                                <div className="paymentReceiptSummary">
                                    <h3><CheckCircle2 size={19} /> Payment successful</h3>
                                    <p className="receiptDisclosure">Test receipt</p>
                                    <div className="paymentReceiptDetails">
                                        <span>Reference<strong>{paymentRecord?.transaction_reference}</strong></span>
                                        <span>Receipt<strong>{paymentRecord?.receipt_number || paymentOutcome.receipt_number || '—'}</strong></span>
                                        <span>Method<strong>{paymentMethod === 'qrph' ? 'QRPH' : paymentMethod === 'card' ? 'Card' : 'Cash'}</strong></span>
                                        <span>Amount<strong>{money(paymentRecord?.amount ?? paymentOutcome.amount)}</strong></span>
                                        <span>Date<strong>{new Date(paymentRecord?.completed_at || paymentOutcome.completed_at || paymentRecord?.created_at).toLocaleString()}</strong></span>
                                    </div>
                                    <div className="dialogActions">
                                        <button className="utilityButton" type="button" onClick={() => window.print()}><Printer size={14} /> Print receipt</button>
                                        <button className="primaryButton" type="button" onClick={() => setIsPaymentOpen(false)}>Done</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="paymentTotal"><span>Amount due</span><strong>{money(paymentRecord?.amount ?? total)}</strong></div>
                                    <label className="paymentField">Payment method
                                        <select value={paymentMethod} disabled={paymentRecord?.status === 'pending'} onChange={(event) => {
                                            setPaymentMethod(event.target.value);
                                            setPaymentError('');
                                            setPaymentRecord(null);
                                            setPaymentOutcome(null);
                                        }}>
                                            {paymentMethods.map((method) => <option value={method.value} key={method.value}>{method.label}</option>)}
                                        </select>
                                    </label>
                                    {paymentMethod === 'cash' && (
                                        <label className="cashAmountField">
                                            <span>Cash received</span>
                                            <input type="number" min={total} step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="Enter amount received" disabled={paymentRecord?.status === 'pending'} />
                                            <strong>Change due: {money(change)}</strong>
                                        </label>
                                    )}
                                    {paymentMethod === 'qrph' && paymentRecord?.status === 'pending' && (
                                        <div className="qrPaymentPanel">
                                            <QRCodeSVG value={`${siteOrigin}/pay/demo/${paymentRecord.id}#token=${encodeURIComponent(paymentRecord.qr_token || '')}`} size={180} level="M" includeMargin aria-label="QRPH payment code" />
                                            <p><QrCode size={14} /> Scan to open the payment page</p>
                                            <div><span>Transaction reference</span><strong>{paymentRecord.transaction_reference}</strong></div>
                                            <div><span>Amount</span><strong>{money(paymentRecord.amount)}</strong></div>
                                            <div className="qrCountdown">Expires in <strong>{Math.floor(qrSeconds / 60)}:{String(qrSeconds % 60).padStart(2, '0')}</strong></div>
                                            {qrSeconds === 0 && <p className="paymentError">This QR payment has expired.</p>}
                                        </div>
                                    )}
                                    {paymentMethod === 'card' && (
                                        <div className="demoCardFields">
                                            <p><CreditCard size={15} /> Test card</p>
                                            <label>Cardholder name<input value="TEST CUSTOMER" readOnly /></label>
                                            <label>Card
                                                <select value={testCardIdentifier} onChange={(event) => setTestCardIdentifier(event.target.value)}>
                                                    <option value="TEST-CARD-001">Test card 001 · Approved</option>
                                                    <option value="TEST-CARD-002">Test card 002 · Declined</option>
                                                    <option value="TEST-CARD-003">Test card 003 · Insufficient funds</option>
                                                </select>
                                            </label>
                                            <label>Expiration<input value="12/30" readOnly /></label>
                                            <small>No actual card number, CVV, or banking details are requested or stored.</small>
                                        </div>
                                    )}
                                    {paymentRecord?.status === 'failed' && (
                                        <p className="paymentError" role="alert">{paymentRecord.failure_reason || paymentError || 'Payment failed. Choose another card to retry.'}</p>
                                    )}
                                    {paymentRecord?.status === 'expired' && <p className="paymentError" role="alert">This payment expired. Start a new payment to continue.</p>}
                                    {paymentError && paymentRecord?.status !== 'failed' && paymentRecord?.status !== 'expired' && <p className="paymentError" role="alert">{paymentError}</p>}
                                    {paymentMethod === 'qrph' && paymentRecord?.status === 'pending' && qrSeconds > 0 && <p className="qrCountdown" role="status">Waiting for payment. Scan the QR code, then tap Pay now on your phone.</p>}
                                    <div className="dialogActions">
                                        <button className="utilityButton" type="button" onClick={paymentRecord?.status === 'pending' ? cancelPayment : () => setIsPaymentOpen(false)} disabled={isSubmitting}>
                                            {paymentRecord?.status === 'pending' ? 'Cancel payment' : 'Close'}
                                        </button>
                                        {!(paymentMethod === 'qrph' && paymentRecord?.status === 'pending') && <button className="primaryButton" type="button" onClick={recordSale} disabled={isSubmitting || (paymentMethod === 'cash' && received < total) || (paymentMethod === 'qrph' && paymentRecord?.status === 'pending' && qrSeconds === 0)}>
                                            {isSubmitting ? 'Processing…' : paymentMethod === 'qrph' ? 'Create QR payment' : paymentMethod === 'card' ? 'Pay by card' : 'Complete payment'}
                                        </button>}
                                    </div>
                                </>
                            )}
                        </div>
                    </section>
                </div>
            )}
            {paymentOutcome?.status === 'paid_simulated' && (
                <div className="printReceipt">
                    <h1>PredictPOS receipt</h1>
                    <p><strong>Test receipt</strong></p>
                    <hr />
                    <p><span>Reference</span><strong>{paymentRecord?.transaction_reference}</strong></p>
                    <p><span>Receipt</span><strong>{paymentRecord?.receipt_number || paymentOutcome.receipt_number || '—'}</strong></p>
                    <p><span>Method</span><strong>{paymentMethod === 'qrph' ? 'QRPH' : paymentMethod === 'card' ? 'Card' : 'Cash'}</strong></p>
                    <p><span>Amount</span><strong>{money(paymentRecord?.amount ?? paymentOutcome.amount)}</strong></p>
                    <p><span>Date</span><strong>{new Date(paymentRecord?.completed_at || paymentOutcome.completed_at || paymentRecord?.created_at).toLocaleString()}</strong></p>
                </div>
            )}
            {saleToVoid && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !isVoiding && setSaleToVoid(null)}>
                    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="void-title">
                        <div className="dialogHeader">
                            <div><p className="eyebrow">VOID SALE</p><h2 id="void-title">{saleToVoid.receipt_number}</h2></div>
                            <button type="button" onClick={() => !isVoiding && setSaleToVoid(null)} aria-label="Close" disabled={isVoiding}>×</button>
                        </div>
                        <form className="dialogBody" onSubmit={voidSale}>
                            <p className="voidInstructions">Voiding restores the sold items to inventory. Use your cashier PIN if you have void permission; otherwise enter a manager PIN.</p>
                            <label className="cashAmountField">
                                <span>Staff PIN</span>
                                <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="one-time-code" value={voidPin} onChange={(event) => setVoidPin(event.target.value)} required />
                            </label>
                            <label className="voidReason">
                                <span>Reason for void</span>
                                <textarea minLength={3} maxLength={250} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required />
                            </label>
                            {voidError && <p className="paymentError" role="alert">{voidError}</p>}
                            <div className="dialogActions">
                                <button className="utilityButton" type="button" onClick={() => setSaleToVoid(null)} disabled={isVoiding}>Cancel</button>
                                <button className="primaryButton" type="submit" disabled={isVoiding}>{isVoiding ? 'Voiding…' : 'Confirm void'}</button>
                            </div>
                        </form>
                    </section>
                </div>
            )}
            {refundSale && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !isRefunding && setRefundSale(null)}>
                    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="refund-title">
                        <div className="dialogHeader">
                            <div><p className="eyebrow">ITEM REFUND</p><h2 id="refund-title">{refundSale.receipt_number}</h2></div>
                            <button type="button" onClick={() => !isRefunding && setRefundSale(null)} aria-label="Close" disabled={isRefunding}>×</button>
                        </div>
                        <div className="dialogBody">
                            <p className="voidInstructions">Select an item and quantity to refund. Returned units are added back to inventory. Use your cashier PIN if refund permission is enabled; otherwise enter a manager PIN.</p>
                            {refundLoading ? <p className="emptyMessage">Loading sale items…</p> : refundItems.length ? (
                                <div className="refundItemList">
                                    {refundItems.map((item) => (
                                        <button
                                            className={`refundItemOption ${item.id === refundItemId ? 'selectedRefundItem' : ''}`}
                                            type="button"
                                            key={item.id}
                                            onClick={() => { setRefundItemId(item.id); setRefundQuantity('1'); }}
                                            disabled={item.remaining_quantity < 1 || isRefunding}
                                        >
                                            <span><strong>{item.product_name}</strong><small>{item.product_sku} · {item.remaining_quantity} refundable of {item.quantity}</small></span>
                                            <strong>{money(item.remaining_subtotal)}</strong>
                                        </button>
                                    ))}
                                </div>
                            ) : <p className="emptyMessage">No refundable items remain on this sale.</p>}
                            {selectedRefundItem && selectedRefundItem.remaining_quantity > 0 && (
                                <form className="refundForm" onSubmit={submitRefund}>
                                    <label className="cashAmountField">
                                        <span>Quantity to refund (up to {selectedRefundItem.remaining_quantity})</span>
                                        <input type="number" min="1" max={selectedRefundItem.remaining_quantity} step="1" value={refundQuantity} onChange={(event) => setRefundQuantity(event.target.value)} required />
                                    </label>
                                    <label className="cashAmountField">
                                        <span>Staff PIN</span>
                                        <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength="4" autoComplete="one-time-code" value={refundPin} onChange={(event) => setRefundPin(event.target.value)} required />
                                    </label>
                                    <label className="voidReason">
                                        <span>Reason for refund</span>
                                        <textarea minLength="3" maxLength="250" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} required />
                                    </label>
                                    {refundError && <p className="paymentError" role="alert">{refundError}</p>}
                                    <div className="dialogActions">
                                        <button className="utilityButton" type="button" onClick={() => setRefundSale(null)} disabled={isRefunding}>Cancel</button>
                                        <button className="primaryButton" type="submit" disabled={isRefunding}>{isRefunding ? 'Refunding…' : 'Refund selected quantity'}</button>
                                    </div>
                                </form>
                            )}
                            {!selectedRefundItem && refundError && <p className="paymentError" role="alert">{refundError}</p>}
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}
