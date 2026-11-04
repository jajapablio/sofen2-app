'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
// The app's Turbopack CSS rule emits global selectors; cashier styles are scoped under .workspace.
import './dashboard.module.css';

const CATEGORIES = ['All', 'Coffee', 'Bakery', 'Sandwiches', 'Drinks'];
const PRODUCTS = [
    { id: 1, sku: 'COF-001', barcode: '4800000000011', name: 'Espresso', price: 2.50, category: 'Coffee', icon: '☕' },
    { id: 2, sku: 'COF-002', barcode: '4800000000028', name: 'Latte', price: 4.00, category: 'Coffee', icon: '🥛' },
    { id: 3, sku: 'COF-003', barcode: '4800000000035', name: 'Cappuccino', price: 4.00, category: 'Coffee', icon: '☕' },
    { id: 4, sku: 'BAK-001', barcode: '4800000000042', name: 'Croissant', price: 3.50, category: 'Bakery', icon: '🥐' },
    { id: 5, sku: 'BAK-002', barcode: '4800000000059', name: 'Blueberry Muffin', price: 3.00, category: 'Bakery', icon: '🧁' },
    { id: 6, sku: 'SAN-001', barcode: '4800000000066', name: 'Ham & Cheese', price: 6.50, category: 'Sandwiches', icon: '🥪' },
    { id: 7, sku: 'SAN-002', barcode: '4800000000073', name: 'Turkey Club', price: 7.50, category: 'Sandwiches', icon: '🥪' },
    { id: 8, sku: 'DRK-001', barcode: '4800000000080', name: 'Orange Juice', price: 3.00, category: 'Drinks', icon: '🧃' },
    { id: 9, sku: 'DRK-002', barcode: '4800000000097', name: 'Iced Tea', price: 2.50, category: 'Drinks', icon: '🧊' },
    { id: 10, sku: 'COF-004', barcode: '4800000000103', name: 'Mocha', price: 4.50, category: 'Coffee', icon: '☕' },
    { id: 11, sku: 'BAK-003', barcode: '4800000000110', name: 'Bagel', price: 2.50, category: 'Bakery', icon: '🥯' },
    { id: 12, sku: 'DRK-003', barcode: '4800000000127', name: 'Cola', price: 2.00, category: 'Drinks', icon: '🥤' }
];

const STORAGE_KEY = 'predictpos-demo-transactions';
const money = (value) => `₱${Number(value || 0).toFixed(2)}`;
const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function CashierWorkspace() {
    const router = useRouter();
    const [activeCategory, setActiveCategory] = useState('All');
    const [search, setSearch] = useState('');
    const [cart, setCart] = useState([]);
    const [cartDiscount, setCartDiscount] = useState(0);
    const [customerEmail, setCustomerEmail] = useState('');
    const [loyaltyCode, setLoyaltyCode] = useState('');
    const [loyaltyPoints, setLoyaltyPoints] = useState(120);
    const [redeemPoints, setRedeemPoints] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [shift, setShift] = useState({ active: false, openedAt: null, openingFloat: 0 });
    const [panel, setPanel] = useState('');
    const [modal, setModal] = useState('');
    const [tenders, setTenders] = useState([]);
    const [cashTenderedInput, setCashTenderedInput] = useState('');
    const [checkoutAfterClockIn, setCheckoutAfterClockIn] = useState(false);
    const [managerRequest, setManagerRequest] = useState(null);
    const [managerPin, setManagerPin] = useState('');
    const [discountValue, setDiscountValue] = useState('');
    const [cashFloat, setCashFloat] = useState('');
    const [declaredCash, setDeclaredCash] = useState('');
    const [returnSelection, setReturnSelection] = useState(null);
    const [returnQty, setReturnQty] = useState(1);
    const [returnMethod, setReturnMethod] = useState('Original tender');
    const [receiptToPrint, setReceiptToPrint] = useState(null);
    const [reportToPrint, setReportToPrint] = useState(null);
    const [toast, setToast] = useState('');

    useEffect(() => {
        const syncConnectivity = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', syncConnectivity);
        window.addEventListener('offline', syncConnectivity);
        const connectivityTimer = window.setTimeout(syncConnectivity, 0);

        const loadTimer = window.setTimeout(() => {
            try {
                const storedTransactions = window.localStorage.getItem(STORAGE_KEY);
                if (storedTransactions) setTransactions(JSON.parse(storedTransactions));
            } catch (error) {
                console.error('Could not load local demo transaction history.', error);
                setToast('Could not load saved demo receipts from this browser.');
            } finally {
                setHistoryLoaded(true);
            }
        }, 0);

        return () => {
            window.removeEventListener('online', syncConnectivity);
            window.removeEventListener('offline', syncConnectivity);
            window.clearTimeout(connectivityTimer);
            window.clearTimeout(loadTimer);
        };
    }, []);

    useEffect(() => {
        if (!historyLoaded) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
        } catch (error) {
            console.error('Could not save local demo transaction history.', error);
            window.setTimeout(() => setToast('Could not save this receipt in browser storage.'), 0);
        }
    }, [historyLoaded, transactions]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = window.setTimeout(() => setToast(''), 3500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const lineSubtotal = useMemo(
        () => cart.reduce((sum, item) => sum + item.price * item.qty * (1 - item.discount / 100), 0),
        [cart]
    );
    const subtotal = lineSubtotal * (1 - cartDiscount / 100);
    const tax = subtotal * 0.08;
    const pointsDiscount = redeemPoints ? Math.min(Math.floor(loyaltyPoints / 100) * 10, subtotal) : 0;
    const total = Math.max(0, subtotal + tax - pointsDiscount);
    const calculateRefund = (transaction, item, quantity) => {
        const itemNetPrice = item.effectiveUnitPrice ?? item.price * (1 - item.discount / 100);
        const prePointsTotal = (transaction.subtotal || 0) + (transaction.tax || 0);
        const pointsAdjustment = prePointsTotal > 0 ? transaction.total / prePointsTotal : 1;
        return itemNetPrice * quantity * 1.08 * pointsAdjustment;
    };
    const tendered = tenders.reduce((sum, tender) => sum + (Number(tender.amount) || 0), 0);
    const nonCashTendered = tenders
        .filter((tender) => tender.method !== 'Cash')
        .reduce((sum, tender) => sum + (Number(tender.amount) || 0), 0);
    const cashTendered = tendered - nonCashTendered;
    const remaining = Math.max(0, total - tendered);
    const change = Math.max(0, cashTendered - Math.max(0, total - nonCashTendered));
    const filteredProducts = PRODUCTS.filter((product) => (
        (activeCategory === 'All' || product.category === activeCategory) &&
        `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(search.toLowerCase())
    ));

    const addToCart = (product) => {
        setCart((current) => {
            const existing = current.find((item) => item.id === product.id);
            return existing
                ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
                : [...current, { ...product, qty: 1, discount: 0, modifier: '' }];
        });
    };

    const scanProduct = (event) => {
        event.preventDefault();
        const query = search.trim().toLowerCase();
        const product = PRODUCTS.find((item) => (
            item.sku.toLowerCase() === query ||
            item.barcode === query ||
            item.name.toLowerCase() === query
        ));
        if (!product) {
            setToast(`No product found for "${search.trim()}".`);
            return;
        }
        addToCart(product);
        setSearch('');
    };

    const updateQty = (id, delta) => {
        setCart((current) => current
            .map((item) => item.id === id ? { ...item, qty: item.qty + delta } : item)
            .filter((item) => item.qty > 0));
    };

    const saveTransactions = (newTransaction) => {
        setTransactions((current) => [newTransaction, ...current]);
    };

    const beginPayment = () => {
        if (!shift.active) {
            setCheckoutAfterClockIn(true);
            setPanel('shift');
            setToast('Clock in to continue checkout.');
            return;
        }
        if (cart.length === 0) return;
        setModal('payment-method');
    };

    const beginCashPayment = () => {
        setCashTenderedInput('');
        setTenders([{ id: `${Date.now()}`, method: 'Cash', amount: '0' }]);
        setModal('cash-payment');
    };

    const beginCardPayment = () => {
        setTenders([{ id: `${Date.now()}`, method: 'Card (demo)', amount: total.toFixed(2) }]);
        setModal('card-payment');
    };

    const addCashTendered = (amount) => {
        setCashTenderedInput((current) => ((Number(current) || 0) + amount).toFixed(2));
        setTenders((current) => current.map((tender) => (
            tender.method === 'Cash'
                ? { ...tender, amount: ((Number(cashTenderedInput) || 0) + amount).toFixed(2) }
                : tender
        )));
    };

    const cashChangeDue = cashTenderedInput !== '' && Number(cashTenderedInput) >= total
        ? Number(cashTenderedInput) - total
        : null;

    const updateCashTendered = (amount) => {
        setCashTenderedInput(amount);
        setTenders((current) => current.map((tender) => (
            tender.method === 'Cash' ? { ...tender, amount } : tender
        )));
    };

    const completePayment = () => {
        if (remaining > 0 || nonCashTendered > total) return;
        if (tenders.some((tender) => Number(tender.amount) < 0)) return;
        const recordedTenders = tenders.map((tender) => ({
            method: tender.method,
            amount: tender.method === 'Cash'
                ? roundCurrency(Math.max(0, (Number(tender.amount) || 0) - change))
                : Number(tender.amount) || 0
        }));
        const transaction = {
            id: `TX-${Date.now()}`,
            type: 'sale',
            createdAt: new Date().toISOString(),
            items: cart.map((item) => ({
                ...item,
                effectiveUnitPrice: item.price * (1 - item.discount / 100) * (1 - cartDiscount / 100)
            })),
            subtotal,
            tax,
            pointsDiscount,
            total,
            customerEmail,
            loyaltyCode,
            tenders: recordedTenders,
            change
        };
        saveTransactions(transaction);
        if (redeemPoints) setLoyaltyPoints((current) => Math.max(0, current - Math.floor(loyaltyPoints / 100) * 100));
        setCart([]);
        setCartDiscount(0);
        setRedeemPoints(false);
        setCustomerEmail('');
        setCashTenderedInput('');
        setModal('');
        setToast(`Demo sale ${transaction.id} recorded locally. No payment terminal was contacted.`);
    };

    const requestManagerOverride = (request) => {
        setManagerRequest(request);
        setManagerPin('');
        if (request.type === 'cart-discount' || request.type === 'item-discount') setDiscountValue('');
        setModal('manager');
    };

    const confirmManagerOverride = (event) => {
        event.preventDefault();
        if (!/^\d{4,8}$/.test(managerPin)) {
            setToast('Enter 4–8 digits to continue in demo mode.');
            return;
        }
        if (managerRequest?.type === 'cart-discount' || managerRequest?.type === 'item-discount') {
            const amount = Number(discountValue);
            if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
                setToast('Discount must be between 0 and 100%.');
                return;
            }
            if (managerRequest.type === 'cart-discount') setCartDiscount(amount);
            else setCart((current) => current.map((item) => (
                item.id === managerRequest.itemId ? { ...item, discount: amount } : item
            )));
            setToast('Discount applied in demo mode. Manager PIN was not verified.');
        } else if (managerRequest?.type === 'void') {
            saveTransactions({
                id: `VOID-${Date.now()}`,
                type: 'void',
                createdAt: new Date().toISOString(),
                items: cart.map((item) => ({ ...item })),
                total,
                reason: managerRequest.reason
            });
            setCart([]);
            setCartDiscount(0);
            setToast('Demo order voided locally. Manager PIN was not verified.');
        } else if (managerRequest?.type === 'return') {
            const { transaction, item } = managerRequest;
            const alreadyReturned = transactions
                .filter((entry) => entry.type === 'return' && entry.originalTransactionId === transaction.id)
                .flatMap((entry) => entry.items)
                .filter((entry) => entry.id === item.id)
                .reduce((sum, entry) => sum + entry.qty, 0);
            if (returnQty > item.qty - alreadyReturned) {
                setToast('Return quantity exceeds the quantity still eligible for return.');
                setModal('');
                setManagerRequest(null);
                return;
            }
            const refund = calculateRefund(transaction, item, returnQty);
            const returnTransaction = {
                id: `RET-${Date.now()}`,
                type: 'return',
                createdAt: new Date().toISOString(),
                originalTransactionId: transaction.id,
                items: [{ ...item, qty: returnQty }],
                total: -refund,
                refundMethod: returnMethod
            };
            saveTransactions(returnTransaction);
            setReturnSelection(null);
            setPanel('');
            setToast(`${money(refund)} demo return recorded locally. No refund was processed.`);
        }
        setModal('');
        setManagerRequest(null);
        setManagerPin('');
    };

    const handleClockIn = (event) => {
        event.preventDefault();
        const openingFloat = Number(cashFloat);
        if (!Number.isFinite(openingFloat) || openingFloat < 0) {
            setToast('Enter a valid starting cash amount.');
            return;
        }
        setShift({ active: true, openedAt: new Date().toISOString(), openingFloat });
        setModal('');
        setPanel('');
        if (checkoutAfterClockIn) {
            setModal('payment-method');
            setCheckoutAfterClockIn(false);
        }
        setToast('Shift started in this demo session.');
    };

    const handleClockOut = (event) => {
        event.preventDefault();
        const declared = Number(declaredCash);
        if (!Number.isFinite(declared) || declared < 0) {
            setToast('Enter a valid declared drawer amount.');
            return;
        }
        const shiftTransactions = transactions.filter((transaction) => (
            transaction.type === 'sale' && transaction.createdAt >= shift.openedAt
        ));
        const cashSales = shiftTransactions.reduce((sum, transaction) => (
            sum + transaction.tenders
                .filter((tender) => tender.method === 'Cash')
                .reduce((tenderSum, tender) => tenderSum + tender.amount, 0)
        ), 0);
        const shiftReturns = transactions.filter((transaction) => (
            transaction.type === 'return' && transaction.createdAt >= shift.openedAt
        ));
        const cashRefunds = shiftReturns.reduce((sum, transaction) => {
            if (transaction.refundMethod === 'Cash (demo)') return sum + Math.abs(transaction.total);
            if (transaction.refundMethod !== 'Original tender') return sum;
            const originalSale = transactions.find((entry) => entry.id === transaction.originalTransactionId);
            if (!originalSale || originalSale.total <= 0) return sum;
            const originalCash = originalSale.tenders
                .filter((tender) => tender.method === 'Cash')
                .reduce((tenderSum, tender) => tenderSum + tender.amount, 0);
            return sum + Math.abs(transaction.total) * originalCash / originalSale.total;
        }, 0);
        const expectedCash = shift.openingFloat + cashSales - cashRefunds;
        const report = {
            createdAt: new Date().toISOString(),
            openedAt: shift.openedAt,
            openingFloat: shift.openingFloat,
            declaredCash: declared,
            expectedCash,
            variance: declared - expectedCash,
            sales: shiftTransactions,
            returns: shiftReturns,
            cashRefunds
        };
        setReportToPrint(report);
        setShift({ active: false, openedAt: null, openingFloat: 0 });
        setModal('');
        setToast('Shift closed. Use Print Z-report to print the blind count summary.');
    };

    const printReceipt = (transaction) => {
        setReceiptToPrint(transaction);
        setReportToPrint(null);
        window.setTimeout(() => window.print(), 50);
    };

    const printReport = () => {
        if (!reportToPrint) {
            setToast('No Z-report is available for this shift yet.');
            return;
        }
        setReceiptToPrint(null);
        window.setTimeout(() => window.print(), 50);
    };

    const openDrawer = () => setToast('Cash drawer control is simulated; no drawer or receipt printer is connected.');

    const returnableTransactions = transactions.filter((transaction) => transaction.type === 'sale');
    const getReturnableQuantity = (transaction, item) => {
        const alreadyReturned = transactions
            .filter((entry) => entry.type === 'return' && entry.originalTransactionId === transaction.id)
            .flatMap((entry) => entry.items)
            .filter((entry) => entry.id === item.id)
            .reduce((sum, entry) => sum + entry.qty, 0);
        return Math.max(0, item.qty - alreadyReturned);
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
                        <div className={`connection ${isOnline ? 'online' : 'offline'}`}>
                            <span />
                            {isOnline ? 'Browser online' : 'Offline'}
                        </div>
                        <span className="demoBadge">LOCAL DEMO · NO BACKEND</span>
                        <button className="iconButton" onClick={() => router.push('/')} aria-label="Log out">
                            <i className="fas fa-sign-out-alt" /> Logout
                        </button>
                    </div>
                </header>
                <div className="systemNote">
                    <i className="fas fa-info-circle" />
                    {isOnline ? 'Receipts are saved in this browser only; backend sync is not configured.' : 'Offline: transactions remain local to this browser; sync is not configured.'}
                </div>

                <div className="toolRow">
                    <form className="searchForm" onSubmit={scanProduct}>
                        <i className="fas fa-barcode" />
                        <input
                            aria-label="Search or scan a product"
                            placeholder="Scan barcode or search by name / SKU"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <button type="submit">Add item</button>
                    </form>
                    <button className="utilityButton" onClick={openDrawer}>
                        <i className="fas fa-cash-register" /> Open drawer
                    </button>
                </div>

                <nav className="categories" aria-label="Product categories">
                    {CATEGORIES.map((category) => (
                        <button
                            key={category}
                            className={activeCategory === category ? 'activeCategory' : ''}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                        </button>
                    ))}
                </nav>

                <div className="productGrid">
                    {filteredProducts.map((product) => (
                        <button key={product.id} className="productCard" onClick={() => addToCart(product)}>
                            <span className="productIcon">{product.icon}</span>
                            <span className="productName">{product.name}</span>
                            <span className="productSku">{product.sku}</span>
                            <span className="productPrice">{money(product.price)}</span>
                        </button>
                    ))}
                    {filteredProducts.length === 0 && (
                        <div className="noProducts">No items match that search. Press Enter to look up an exact SKU or barcode.</div>
                    )}
                </div>
                <footer className="catalogFooter">
                    <span>Demo catalog · {PRODUCTS.length} sample products</span>
                    <span>Juan Dela Cruz · Cashier</span>
                </footer>
            </section>

            <aside className="order">
                <div className="orderHeader">
                    <div>
                        <p className="eyebrow">ACTIVE SALE</p>
                        <h2>Current order <span>{cart.reduce((count, item) => count + item.qty, 0)}</span></h2>
                    </div>
                    <button className="textButton" onClick={() => { setCart([]); setCartDiscount(0); }} disabled={!cart.length}>Clear</button>
                </div>

                <div className="cartList">
                    {!cart.length ? (
                        <div className="emptyCart">
                            <i className="fas fa-shopping-basket" />
                            <strong>Your order is empty</strong>
                            <span>Scan a barcode or choose a product.</span>
                        </div>
                    ) : cart.map((item) => (
                        <article key={item.id} className="cartItem">
                            <div className="cartItemHeading">
                                <div>
                                    <strong>{item.name}</strong>
                                    <small>{item.sku}{item.discount ? ` · ${item.discount}% off` : ''}</small>
                                </div>
                                <strong>{money(item.price * item.qty * (1 - item.discount / 100))}</strong>
                            </div>
                            <div className="cartItemActions">
                                <div className="quantity">
                                    <button onClick={() => updateQty(item.id, -1)} aria-label={`Decrease ${item.name}`}>−</button>
                                    <span>{item.qty}</span>
                                    <button onClick={() => updateQty(item.id, 1)} aria-label={`Increase ${item.name}`}>+</button>
                                </div>
                                <button className="smallAction" onClick={() => requestManagerOverride({ type: 'item-discount', itemId: item.id })}>Discount</button>
                                <button className="removeAction" onClick={() => setCart((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.name}`}>
                                    <i className="fas fa-trash-alt" />
                                </button>
                            </div>
                        </article>
                    ))}
                </div>

                <div className="customerFields">
                    <label>
                        <span>Digital receipt email</span>
                        <input type="email" placeholder="customer@example.com" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
                    </label>
                    <div className="loyaltyRow">
                        <label>
                            <span>Loyalty barcode</span>
                            <input placeholder="Scan or enter code" value={loyaltyCode} onChange={(event) => setLoyaltyCode(event.target.value)} />
                        </label>
                        <button onClick={() => {
                            if (!loyaltyCode.trim()) setToast('Enter or scan a loyalty barcode first.');
                            else setToast(`Demo member linked · ${loyaltyPoints} sample points available.`);
                        }}>Lookup</button>
                    </div>
                    <button className="pointsButton" onClick={() => {
                        if (!loyaltyCode.trim()) {
                            setToast('Link a loyalty barcode before applying points.');
                            return;
                        }
                        setRedeemPoints((current) => !current);
                    }} disabled={!cart.length}>
                        <i className="fas fa-star" /> {redeemPoints ? 'Remove reward points' : `Apply reward points · ${loyaltyPoints} available`}
                    </button>
                </div>

                <div className="totals">
                    <div><span>Subtotal</span><strong>{money(lineSubtotal)}</strong></div>
                    <div className="discountRow">
                        <button onClick={() => requestManagerOverride({ type: 'cart-discount' })}>Cart discount {cartDiscount ? `(${cartDiscount}%)` : ''}</button>
                        <strong>−{money(lineSubtotal * cartDiscount / 100)}</strong>
                    </div>
                    <div><span>Tax (8%)</span><strong>{money(tax)}</strong></div>
                    {pointsDiscount > 0 && <div><span>Rewards</span><strong>−{money(pointsDiscount)}</strong></div>}
                    <div className="grandTotal"><span>Total due</span><strong>{money(total)}</strong></div>
                </div>
                <div className="checkoutActions">
                    <button className="checkoutButton" onClick={beginPayment} disabled={!cart.length}>
                        <i className="fas fa-credit-card" /> {shift.active ? 'Take payment' : 'Clock in to take payment'}
                    </button>
                    <button className="voidButton" onClick={() => requestManagerOverride({ type: 'void', reason: 'Cashier requested order void' })} disabled={!cart.length}>
                        Void order
                    </button>
                </div>
                <div className="operations">
                    <button onClick={() => { setPanel('returns'); setReturnSelection(null); }}><i className="fas fa-undo" /> Returns</button>
                    <button onClick={() => setPanel('receipts')}><i className="fas fa-receipt" /> Receipts</button>
                    <button onClick={() => setPanel('shift')}><i className="fas fa-clock" /> Shift</button>
                </div>
                <div className={`shiftStatus ${shift.active ? 'shiftOpen' : ''}`}>
                    <span><i className={`fas ${shift.active ? 'fa-check-circle' : 'fa-exclamation-circle'}`} /> {shift.active ? 'Shift open' : 'Clock in to start sales'}</span>
                    <button onClick={() => setPanel('shift')}>{shift.active ? 'Manage' : 'Clock in'}</button>
                </div>
            </aside>

            {panel === 'receipts' && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPanel('')}>
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">LOCAL BROWSER HISTORY</p><h2>Receipts & transactions</h2></div><button onClick={() => setPanel('')} aria-label="Close">×</button></div>
                        <div className="dialogBody">
                            {transactions.length === 0 ? <p className="emptyMessage">No transactions have been recorded in this browser yet.</p> : transactions.map((transaction) => (
                                <article className="historyCard" key={transaction.id}>
                                    <div><strong>{transaction.id}</strong><span>{new Date(transaction.createdAt).toLocaleString()}</span><small>{transaction.items?.length || 0} items · {transaction.type}</small></div>
                                    <strong>{money(Math.abs(transaction.total))}</strong>
                                    <div className="historyActions">
                                        {transaction.type === 'sale' && <button onClick={() => { setReturnSelection(transaction); setReturnQty(1); setPanel('returns'); }}>Return</button>}
                                        {transaction.type === 'sale' && <button onClick={() => printReceipt(transaction)}>Reprint</button>}
                                    </div>
                                </article>
                            ))}
                        </div>
                        <p className="demoFootnote">Reprints use your browser’s print dialog. This demo does not connect to a receipt printer.</p>
                    </section>
                </div>
            )}

            {panel === 'returns' && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPanel('')}>
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">MANAGER OVERRIDE REQUIRED</p><h2>Process a return</h2></div><button onClick={() => { setPanel(''); setReturnSelection(null); }} aria-label="Close">×</button></div>
                        <div className="dialogBody">
                            {!returnSelection ? (
                                <>
                                    <p className="demoFootnote">Choose a completed demo sale, then select the item and quantity to return.</p>
                                    {returnableTransactions.length === 0 ? <p className="emptyMessage">No completed sales are available to return.</p> : returnableTransactions.map((transaction) => (
                                        <button className="selectTransaction" key={transaction.id} onClick={() => { setReturnSelection(transaction); setReturnQty(1); }}>
                                            <span><strong>{transaction.id}</strong><small>{new Date(transaction.createdAt).toLocaleString()}</small></span>
                                            <strong>{money(transaction.total)} <i className="fas fa-chevron-right" /></strong>
                                        </button>
                                    ))}
                                </>
                            ) : (
                                <>
                                    <button className="backButton" onClick={() => setReturnSelection(null)}>← Choose another sale</button>
                                    <p className="demoFootnote">Original sale: {returnSelection.id}</p>
                                    <label className="refundMethod">Refund method
                                        <select value={returnMethod} onChange={(event) => setReturnMethod(event.target.value)}>
                                            <option>Original tender</option><option>Cash (demo)</option><option>Card (demo)</option><option>Mobile wallet (demo)</option>
                                        </select>
                                    </label>
                                    {returnSelection.items.map((item) => {
                                        const quantityRemaining = getReturnableQuantity(returnSelection, item);
                                        return (
                                            <article className="returnItem" key={`${returnSelection.id}-${item.id}`}>
                                                <div><strong>{item.name}</strong><small>{money(item.price)} each · {quantityRemaining} eligible of {item.qty} sold</small></div>
                                                <input type="number" min="1" max={quantityRemaining} value={Math.min(returnQty, quantityRemaining || 1)} disabled={!quantityRemaining} onChange={(event) => setReturnQty(Math.min(quantityRemaining, Math.max(1, Number(event.target.value) || 1)))} aria-label="Return quantity" />
                                                <button disabled={!quantityRemaining} onClick={() => {
                                                const quantityToReturn = Math.min(returnQty, quantityRemaining);
                                                setReturnQty(quantityToReturn);
                                                requestManagerOverride({ type: 'return', transaction: returnSelection, item });
                                                }}>Refund {money(calculateRefund(returnSelection, item, Math.min(returnQty, quantityRemaining)))}</button>
                                            </article>
                                        );
                                    })}
                                    <p className="demoFootnote">Return is recorded locally only; this demo cannot issue a real refund.</p>
                                </>
                            )}
                        </div>
                    </section>
                </div>
            )}

            {panel === 'shift' && (
                <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPanel('')}>
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">SHIFT OPERATIONS</p><h2>{shift.active ? 'Cashier shift' : 'Start a shift'}</h2></div><button onClick={() => { setPanel(''); setCheckoutAfterClockIn(false); }} aria-label="Close">×</button></div>
                        <div className="dialogBody">
                            {shift.active ? (
                                <>
                                    <div className="shiftSummary">
                                        <div><span>Status</span><strong>Clocked in</strong></div>
                                        <div><span>Started</span><strong>{new Date(shift.openedAt).toLocaleString()}</strong></div>
                                        <div><span>Starting float</span><strong>{money(shift.openingFloat)}</strong></div>
                                    </div>
                                    <p className="demoFootnote">Blind balancing: enter the counted drawer cash before the Z-report shows sales totals.</p>
                                    <form className="dialogForm" onSubmit={(event) => { setDeclaredCash(''); setModal('clock-out'); event.preventDefault(); }}>
                                        <button type="button" className="utilityButton" onClick={openDrawer}><i className="fas fa-cash-register" /> Open drawer</button>
                                        <button type="submit" className="primaryButton">Clock out &amp; declare cash</button>
                                    </form>
                                </>
                            ) : (
                                <form className="dialogForm" onSubmit={handleClockIn}>
                                    <p className="demoFootnote">Record the starting cash float. Sales are disabled until you clock in.</p>
                                    <label>Starting drawer amount<input required type="number" min="0" step="0.01" value={cashFloat} onChange={(event) => setCashFloat(event.target.value)} placeholder="0.00" /></label>
                                    <button className="primaryButton">Clock in</button>
                                </form>
                            )}
                            {reportToPrint && <button className="utilityButton" onClick={printReport}><i className="fas fa-print" /> Print last Z-report</button>}
                        </div>
                    </section>
                </div>
            )}

            {modal === 'payment-method' && (
                <div className="overlay">
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">PAYMENT METHOD</p><h2>How would they like to pay?</h2></div><button onClick={() => setModal('')} aria-label="Close">×</button></div>
                        <div className="dialogBody">
                            <div className="paymentTotal"><span>Total due</span><strong>{money(total)}</strong></div>
                            <div className="paymentMethodButtons">
                                <button className="paymentMethodButton cashMethod" onClick={beginCashPayment}>
                                    <i className="fas fa-money-bill-wave" />
                                    <strong>Cash</strong>
                                    <span>Enter amount received</span>
                                </button>
                                <button className="paymentMethodButton cardMethod" onClick={beginCardPayment}>
                                    <i className="fas fa-credit-card" />
                                    <strong>Card</strong>
                                    <span>Record demo card payment</span>
                                </button>
                            </div>
                            <p className="demoFootnote">These are demo payments only. No cash drawer, card terminal, or payment provider is connected.</p>
                        </div>
                    </section>
                </div>
            )}

            {modal === 'cash-payment' && (
                <div className="overlay">
                    <section className="dialog cashPaymentDialog">
                        <div className="dialogHeader"><div><p className="eyebrow">CASH PAYMENT · DEMO</p><h2>Cash payment</h2></div><button onClick={() => setModal('payment-method')} aria-label="Close">×</button></div>
                        <div className="dialogBody cashPaymentBody">
                            <div className="paymentTotal"><span>Total due</span><strong>{money(total)}</strong></div>
                            <label className="cashAmountField">
                                <span>Amount tendered</span>
                                <input
                                    autoFocus
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Enter tendered amount"
                                    value={cashTenderedInput}
                                    onChange={(event) => updateCashTendered(event.target.value)}
                                />
                            </label>
                            <div className="quickCashButtons">
                                {[100, 500, 1000].map((amount) => (
                                    <button key={amount} onClick={() => addCashTendered(amount)}>{money(amount)}</button>
                                ))}
                            </div>
                            <div className={`cashChangeDisplay ${cashChangeDue === null ? 'insufficient' : ''}`}>
                                {cashTenderedInput === ''
                                    ? `Change: ${money(0)}`
                                    : cashChangeDue !== null
                                        ? `Change: ${money(cashChangeDue)}`
                                        : 'Insufficient amount'}
                            </div>
                            <p className="demoFootnote">Opening the drawer is simulated. No physical drawer is connected.</p>
                            <div className="dialogActions">
                                <button className="utilityButton" onClick={() => setModal('payment-method')}>Back</button>
                                <button className="primaryButton" disabled={cashChangeDue === null} onClick={completePayment}>Complete &amp; Open Drawer</button>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {modal === 'card-payment' && (
                <div className="overlay">
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">CARD PAYMENT · DEMO</p><h2>Confirm card payment</h2></div><button onClick={() => setModal('payment-method')} aria-label="Close">×</button></div>
                        <div className="dialogBody">
                            <div className="paymentTotal"><span>Amount to charge</span><strong>{money(total)}</strong></div>
                            <p className="demoFootnote">This only records a demo card tender. No card terminal or payment provider will be contacted.</p>
                            <div className="dialogActions">
                                <button className="utilityButton" onClick={() => setModal('payment-method')}>Back</button>
                                <button className="primaryButton" onClick={completePayment}>Confirm demo card payment</button>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {modal === 'manager' && (
                <div className="overlay">
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">DEMO OVERRIDE</p><h2>Manager approval</h2></div><button onClick={() => { setModal(''); setManagerRequest(null); }} aria-label="Close">×</button></div>
                        <form className="dialogForm" onSubmit={confirmManagerOverride}>
                            {(managerRequest?.type === 'cart-discount' || managerRequest?.type === 'item-discount') && (
                                <label>Discount percent<input autoFocus required type="number" min="0" max="100" step="1" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0–100" /></label>
                            )}
                            {managerRequest?.type === 'void' && <p>Void the current order? The action will be recorded in local demo history.</p>}
                            {managerRequest?.type === 'return' && <p>Approve a local demo refund to {returnMethod}? No real refund will be issued.</p>}
                            <label>Manager PIN (demo only)<input required type="password" inputMode="numeric" pattern="[0-9]{4,8}" maxLength="8" value={managerPin} onChange={(event) => setManagerPin(event.target.value)} placeholder="Enter 4–8 digits" /></label>
                            <p className="warningNote">This prototype does not validate manager credentials. Do not use for live transactions.</p>
                            <div className="dialogActions">
                                <button type="button" className="utilityButton" onClick={() => { setModal(''); setManagerRequest(null); }}>Cancel</button>
                                <button className="primaryButton">Continue in demo</button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            {modal === 'clock-out' && (
                <div className="overlay">
                    <section className="dialog">
                        <div className="dialogHeader"><div><p className="eyebrow">BLIND CASH COUNT</p><h2>Declare drawer amount</h2></div><button onClick={() => setModal('')} aria-label="Close">×</button></div>
                        <form className="dialogForm" onSubmit={handleClockOut}>
                            <p>Count the drawer before viewing the shift totals.</p>
                            <label>Cash counted<input autoFocus required type="number" min="0" step="0.01" value={declaredCash} onChange={(event) => setDeclaredCash(event.target.value)} placeholder="0.00" /></label>
                            <div className="dialogActions"><button type="button" className="utilityButton" onClick={() => setModal('')}>Cancel</button><button className="primaryButton">Close shift &amp; create Z-report</button></div>
                        </form>
                    </section>
                </div>
            )}

            {toast && <div className="toast" role="status">{toast}</div>}

            {(receiptToPrint || reportToPrint) && (
                <section className="printReceipt">
                    {receiptToPrint ? (
                        <>
                            <h1>PredictPOS · Demo receipt</h1>
                            <p>{receiptToPrint.id}</p><p>{new Date(receiptToPrint.createdAt).toLocaleString()}</p>
                            {receiptToPrint.customerEmail && <p>Digital receipt requested: {receiptToPrint.customerEmail}</p>}
                            <hr />
                            {receiptToPrint.items.map((item, index) => <p key={`${item.id}-${index}`}>{item.qty} × {item.name} <span>{money(item.price * item.qty * (1 - item.discount / 100))}</span></p>)}
                            <hr /><p>Total <span>{money(receiptToPrint.total)}</span></p>
                            <p>Local demo record — not a fiscal receipt</p>
                        </>
                    ) : (
                        <>
                            <h1>PredictPOS · Z-report (demo)</h1>
                            <p>Closed {new Date(reportToPrint.createdAt).toLocaleString()}</p>
                            <p>Shift started {new Date(reportToPrint.openedAt).toLocaleString()}</p>
                            <hr /><p>Opening float <span>{money(reportToPrint.openingFloat)}</span></p>
                            <p>Expected cash <span>{money(reportToPrint.expectedCash)}</span></p>
                            <p>Declared drawer cash <span>{money(reportToPrint.declaredCash)}</span></p>
                            <p>Cash refunds <span>{money(reportToPrint.cashRefunds)}</span></p>
                            <p>Cash variance <span>{money(reportToPrint.variance)}</span></p>
                            <p>Sales count <span>{reportToPrint.sales.length}</span></p>
                            <p>Returns count <span>{reportToPrint.returns.length}</span></p>
                            <p>Sales total <span>{money(reportToPrint.sales.reduce((sum, transaction) => sum + transaction.total, 0))}</span></p>
                            <p>Demo only — not a fiscal report</p>
                        </>
                    )}
                </section>
            )}
        </main>
    );
}
