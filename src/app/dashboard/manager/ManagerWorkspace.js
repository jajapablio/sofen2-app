'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import InteractiveParticles from '../../../components/InteractiveParticles';
import { getSupabaseClient } from '../../../lib/supabase/client';
import RevenueTrend from '../../../components/RevenueTrend';
import ForecastEngine from '../../../components/ForecastEngine';
import EmployeeForm from './EmployeeForm';
import styles from './manager.module.css';

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const money = (value) => currency.format(Number(value) || 0);
const dateTime = (value) => value ? new Date(value).toLocaleString() : '—';
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tabs = [
    { id: 'overview', label: 'Overview', icon: 'fa-home' },
    { id: 'inventory', label: 'Inventory & Orders', icon: 'fa-box-open' },
    { id: 'staff', label: 'Staff', icon: 'fa-users' },
    { id: 'financials', label: 'Financials', icon: 'fa-chart-line' },
];

function DataTable({ columns, rows, emptyMessage }) {
    if (!rows.length) return <p className={styles.emptyState}>{emptyMessage}</p>;

    return (
        <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
                <thead>
                    <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id}>
                            {columns.map((column) => (
                                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ManagerWorkspace({ requiredRole }) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState('overview');
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
    const sidebarRef = useRef(null);
    const [profile, setProfile] = useState(null);
    const [storeName, setStoreName] = useState('');
    const [products, setProducts] = useState([]);
    const [sales, setSales] = useState([]);
    const [forecasts, setForecasts] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [updatingOrder, setUpdatingOrder] = useState('');
    const [showCreateOrderForm, setShowCreateOrderForm] = useState(false);
    const [newOrderProductId, setNewOrderProductId] = useState('');
    const [newOrderQuantity, setNewOrderQuantity] = useState('');
    const [creatingOrder, setCreatingOrder] = useState(false);
    const [salesForecasts, setSalesForecasts] = useState([]);
    const [stockAlerts, setStockAlerts] = useState([]);
    const [generatingForecast, setGeneratingForecast] = useState(false);

    useEffect(() => {
        if (!isNavigationOpen) return undefined;

        const closeOnOutsideClick = (event) => {
            if (!sidebarRef.current?.contains(event.target)) setIsNavigationOpen(false);
        };
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') setIsNavigationOpen(false);
        };

        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isNavigationOpen]);

    useEffect(() => {
        let isCurrent = true;

        const loadDashboard = async () => {
            setLoading(true);
            setError('');
            setActionError('');

            try {
                const supabase = getSupabaseClient();
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                if (authError) throw authError;
                if (!user) {
                    router.replace('/');
                    return;
                }

                const { data: currentProfile, error: profileError } = await supabase
                    .from('profiles')
                    .select('id, full_name, role, store_id, global_access, is_active')
                    .eq('id', user.id)
                    .maybeSingle();
                if (profileError) throw profileError;
                if (!currentProfile?.is_active) {
                    await supabase.auth.signOut();
                    router.replace('/');
                    return;
                }
                const hasRequiredRole = requiredRole === 'admin'
                    ? currentProfile.role === 'admin'
                    : currentProfile.role === requiredRole;
                if (!hasRequiredRole) {
                    router.replace(currentProfile.role === 'admin'
                        ? '/dashboard/admin'
                        : currentProfile.role === 'manager'
                            ? '/dashboard/manager'
                            : '/dashboard');
                    return;
                }
                if (!currentProfile.store_id && (requiredRole === 'admin' || !currentProfile.global_access)) {
                    throw new Error('Your staff profile is not assigned to a store. Ask an administrator to finish setup.');
                }

                const storeScoped = requiredRole === 'admin' || !currentProfile.global_access;
                const salesSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const today = new Date().toISOString().slice(0, 10);
                const storeQuery = supabase.from('stores').select('name').order('name');
                const productsQuery = supabase.from('products')
                    .select('id, name, sku, category, image_url, selling_price, current_stock, updated_at')
                    .order('name');
                const salesQuery = supabase.from('sales')
                    .select('id, receipt_number, total_amount, tax_amount, payment_method, status, created_at')
                    .eq('status', 'completed')
                    .gte('created_at', salesSince)
                    .order('created_at', { ascending: false });
                const purchaseOrdersQuery = supabase.from('purchase_orders')
                    .select('id, store_id, product_id, suggested_quantity, status, created_at')
                    .order('created_at', { ascending: false })
                    .limit(100);
                const staffQuery = supabase.from('profiles')
                    .select('id, full_name, username, role, is_active, created_at')
                    .order('full_name');
                const forecastsQuery = supabase.from('inventory_forecasts')
                    .select('id, product_id, forecast_date, predicted_demand, confidence_score, is_anomaly, current_stock, suggested_restock, days_until_shortage, created_at, products!inner(store_id)')
                    .gt('forecast_date', today)
                    .order('forecast_date')
                    .limit(50);

                const salesForecastsQuery = supabase.from('sales_forecasts')
                    .select('id, forecast_date, predicted_sales, confidence_score, actual_sales, variance_percent, created_at')
                    .gt('forecast_date', today)
                    .eq('period_type', 'daily')
                    .order('forecast_date', { ascending: true })
                    .limit(500);

                const stockAlertsQuery = supabase.from('stock_shortage_alerts')
                    .select('*')
                    .order('days_until_shortage', { ascending: true, nullsFirst: false })
                    .limit(20);

                if (storeScoped) {
                    storeQuery.eq('id', currentProfile.store_id);
                    productsQuery.eq('store_id', currentProfile.store_id);
                    salesQuery.eq('store_id', currentProfile.store_id);
                    purchaseOrdersQuery.eq('store_id', currentProfile.store_id);
                    staffQuery.eq('store_id', currentProfile.store_id);
                    forecastsQuery.eq('products.store_id', currentProfile.store_id);
                    salesForecastsQuery.eq('store_id', currentProfile.store_id);
                    stockAlertsQuery.eq('store_id', currentProfile.store_id);
                }

                const results = await Promise.all([
                    storeQuery,
                    productsQuery,
                    salesQuery,
                    forecastsQuery,
                    purchaseOrdersQuery,
                    staffQuery,
                    salesForecastsQuery,
                    stockAlertsQuery,
                ]);
                const failedResult = results.find((result) => result.error);
                if (failedResult) throw failedResult.error;
                if (!isCurrent) return;

                setProfile(currentProfile);
                setStoreName(storeScoped ? results[0].data?.[0]?.name || 'Store not assigned' : 'All locations');
                setProducts(results[1].data || []);
                setSales(results[2].data || []);
                setForecasts(results[3].data || []);
                setPurchaseOrders(results[4].data || []);
                setStaff(results[5].data || []);
                setSalesForecasts(results[6].data || []);
                setStockAlerts(results[7].data || []);
            } catch (loadError) {
                if (isCurrent) setError(loadError.message || 'Unable to load dashboard data.');
            } finally {
                if (isCurrent) setLoading(false);
            }
        };

        loadDashboard();
        return () => { isCurrent = false; };
    }, [refreshKey, requiredRole, router]);

    const approveOrder = async (order) => {
        setUpdatingOrder(order.id);
        setActionError('');

        try {
            const supabase = getSupabaseClient();
            const { error: updateError } = await supabase
                .from('purchase_orders')
                .update({ status: 'approved', approved_by: profile.id })
                .eq('id', order.id)
                .eq('store_id', order.store_id);
            if (updateError) throw updateError;
            setPurchaseOrders((current) => current.map((entry) => (
                entry.id === order.id ? { ...entry, status: 'approved' } : entry
            )));
        } catch (updateError) {
            setActionError(updateError.message || 'Unable to approve the purchase order.');
        } finally {
            setUpdatingOrder('');
        }
    };

    const createPurchaseOrder = async () => {
        setCreatingOrder(true);
        setActionError('');

        try {
            const supabase = getSupabaseClient();
            const { data, error: insertError } = await supabase
                .from('purchase_orders')
                .insert({
                    store_id: profile.store_id,
                    product_id: newOrderProductId,
                    suggested_quantity: Number(newOrderQuantity),
                    status: 'pending_approval',
                })
                .select()
                .maybeSingle();

            if (insertError) throw insertError;

            setPurchaseOrders((current) => [data, ...current]);
            setShowCreateOrderForm(false);
            setNewOrderProductId('');
            setNewOrderQuantity('');
        } catch (insertError) {
            setActionError(insertError.message || 'Unable to create purchase order.');
        } finally {
            setCreatingOrder(false);
        }
    };

    const generateForecasts = async () => {
        setGeneratingForecast(true);
        setActionError('');

        try {
            const supabase = getSupabaseClient();
            const { data, error: rpcError } = await supabase.rpc('generate_forecasts', {
                p_store_id: profile.store_id,
            });

            if (rpcError) throw rpcError;

            setRefreshKey((current) => current + 1);
        } catch (rpcError) {
            setActionError(rpcError.message || 'Unable to generate forecasts.');
        } finally {
            setGeneratingForecast(false);
        }
    };

    const handleLogout = async () => {
        try {
            await getSupabaseClient().auth.signOut();
        } finally {
            router.replace('/');
        }
    };

    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekSales = sales.filter((sale) => new Date(sale.created_at) >= weekStart);
    const weekRevenue = weekSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
    const weekAverage = weekSales.length ? weekRevenue / weekSales.length : 0;
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const dayBars = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + index);
        const key = dateKey(day);
        const amount = weekSales
            .filter((sale) => dateKey(new Date(sale.created_at)) === key)
            .reduce((sum, sale) => sum + Number(sale.total_amount), 0);
        return { key, label: day.toLocaleDateString('en-US', { weekday: 'short' }), amount };
    });
    const maxBar = Math.max(1, ...dayBars.map((day) => day.amount));
    const titles = {
        overview: 'Operational overview',
        inventory: 'Inventory & purchase orders',
        staff: 'Staff directory',
        financials: 'Sales & financials',
    };
    const workspaceRole = requiredRole === 'admin' ? 'Store administrator' : 'Manager';
    const initials = (profile?.full_name || workspaceRole)
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    return (
        <div className={styles.container}>
            <aside ref={sidebarRef} className={styles.sidebar}>
                <InteractiveParticles />
                <div className={styles.sidebarHeader}>
                    <div className={styles.logo}>
                        <Image src="/logos/android-chrome-192x192.png" alt="" className={styles.logoIcon} width={48} height={48} />
                        <span className={styles.logoText}>redictPOS</span>
                    </div>
                    <button
                        className={styles.navToggle}
                        type="button"
                        onClick={() => setIsNavigationOpen((open) => !open)}
                        aria-label={isNavigationOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={isNavigationOpen}
                        aria-controls="manager-navigation-popover"
                        title={isNavigationOpen ? 'Close navigation' : 'Open navigation'}
                    >
                        <span className={`${styles.menuGlyph} ${isNavigationOpen ? styles.menuGlyphOpen : ''}`} aria-hidden="true"><span /></span>
                    </button>
                </div>

                <div id="manager-navigation-popover" className={`${styles.navPopover} ${isNavigationOpen ? styles.navPopoverOpen : ''}`}>
                        <nav className={styles.navLinks} aria-label={`${workspaceRole} navigation`}>
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    className={`${styles.navItem} ${activeTab === tab.id ? styles.active : ''}`}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                    onClick={() => {
                                        setActiveTab(tab.id);
                                        setIsNavigationOpen(false);
                                    }}
                                >
                                    <i className={`fas ${tab.icon}`} aria-hidden="true" /> {tab.label}
                                </button>
                            ))}
                        </nav>

                        <div className={styles.userProfile}>
                            <div className={styles.userAvatar}>{initials}</div>
                            <div className={styles.userInfo}>
                                <h4>{profile?.full_name || workspaceRole}</h4>
                                <p>{storeName || 'Store not assigned'}</p>
                            </div>
                            <button type="button" className={styles.logoutButton} onClick={handleLogout} aria-label="Log out" title="Log out">
                                <i className="fas fa-sign-out-alt" aria-hidden="true" />
                                <span>Log out</span>
                            </button>
                        </div>
                </div>
            </aside>

            <main className={styles.mainContent}>
                <header className={styles.header}>
                    <div>
                        <p className={styles.storeLabel}>{storeName || `${workspaceRole.toUpperCase()} WORKSPACE`}</p>
                        <h1>{titles[activeTab]}</h1>
                    </div>
                    <div className={styles.headerActions}>
                        <span className={styles.dateDisplay}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                        <button className={styles.refreshBtn} type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
                            <i className="fas fa-sync-alt" aria-hidden="true" /> Refresh
                        </button>
                    </div>
                </header>

                {(error || actionError) && <div className={styles.errorState} role="alert">{error || actionError}</div>}
                {loading ? (
                    <div className={styles.loadingState} role="status">Loading store data…</div>
                ) : !error && (
                    <>
                        {activeTab === 'overview' && (
                            <div className={styles.grid}>
                                <div className={styles.forecastPanel}><RevenueTrend sales={sales} /></div>
                                <div className={styles.forecastPanel}><ForecastEngine forecasts={salesForecasts} alerts={stockAlerts} onRefresh={generateForecasts} busy={generatingForecast} disabled={!profile?.store_id} /></div>

                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}>
                                        <div className={styles.cardTitle}>Product Demand Forecast · Next 7 Days</div>
                                        <div className={styles.cardSubtitle}>Predicted units to sell per product</div>
                                    </div>
                                    <DataTable
                                        columns={[
                                            { key: 'name', label: 'Product', render: (f) => productNames.get(f.product_id) || 'Product' },
                                            { key: 'predicted_demand', label: 'Predicted Demand' },
                                            { key: 'current_stock', label: 'Current Stock', render: (f) => f.current_stock },
                                            { key: 'suggested_restock', label: 'Suggested Restock', render: (f) => f.suggested_restock },
                                            { key: 'confidence_score', label: 'Confidence', render: (f) => `${f.confidence_score}%` },
                                            { key: 'days_until_shortage', label: 'Days Until Shortage', render: (f) => f.days_until_shortage === null ? '—' : f.days_until_shortage === 0 ? 'NOW' : f.days_until_shortage },
                                        ]}
                                        rows={forecasts}
                                        emptyMessage="Demand predictions appear automatically after completed sales are recorded."
                                    />
                                </section>

                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}><div className={styles.cardTitle}>Recent sales</div></div>
                                    <DataTable
                                        columns={[
                                            { key: 'receipt_number', label: 'Receipt' },
                                            { key: 'created_at', label: 'Date', render: (sale) => dateTime(sale.created_at) },
                                            { key: 'payment_method', label: 'Payment' },
                                            { key: 'total_amount', label: 'Total', render: (sale) => money(sale.total_amount) },
                                        ]}
                                        rows={sales.slice(0, 8)}
                                        emptyMessage="No completed sales have been recorded in the last 30 days."
                                    />
                                </section>
                            </div>
                        )}

                        {activeTab === 'inventory' && (
                            <div className={styles.grid}>
                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}><div className={styles.cardTitle}>Store catalog</div></div>
                                    <DataTable
                                        columns={[
                                            { key: 'sku', label: 'SKU' },
                                            { key: 'name', label: 'Product', render: (product) => <div className={styles.productCell}>{product.image_url ? <Image src={product.image_url} alt="" width={42} height={42} unoptimized className={styles.productThumbnail} /> : <span className={styles.productPlaceholder}><i className="fas fa-box" aria-hidden="true" /></span>}<span>{product.name}</span></div> },
                                            { key: 'category', label: 'Category', render: (product) => product.category || '—' },
                                            { key: 'current_stock', label: 'On hand' },
                                            { key: 'selling_price', label: 'Price', render: (product) => money(product.selling_price) },
                                        ]}
                                        rows={products}
                                        emptyMessage="No products have been added to this store yet."
                                    />
                                </section>
                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}>
                                        <div className={styles.cardTitle}>Purchase orders</div>
                                        <button className={styles.approveButton} type="button" onClick={() => setShowCreateOrderForm(true)} disabled={creatingOrder}>
                                            {creatingOrder ? 'Creating…' : 'Create Purchase Order'}
                                        </button>
                                    </div>
                                    {profile?.role !== 'admin' && (
                                        <p className={styles.formFeedback}>
                                            Managers create purchase orders. Admins approve them. Orders appear as Pending Approval until an admin reviews them.
                                        </p>
                                    )}
                                    <DataTable
                                        columns={[
                                            { key: 'created_at', label: 'Created', render: (order) => dateTime(order.created_at) },
                                            { key: 'product_id', label: 'Product', render: (order) => productNames.get(order.product_id) || 'Product' },
                                            { key: 'suggested_quantity', label: 'Quantity' },
                                            { key: 'status', label: 'Status', render: (order) => <span className={styles.statusBadge}>{order.status.replaceAll('_', ' ')}</span> },
                                            { key: 'action', label: 'Action', render: (order) => {
                                                if (order.status !== 'pending_approval') return '—';
                                                if (profile?.role === 'admin') {
                                                    return (
                                                        <button className={styles.approveButton} type="button" onClick={() => approveOrder(order)} disabled={updatingOrder === order.id}>
                                                            {updatingOrder === order.id ? 'Saving…' : 'Approve'}
                                                        </button>
                                                    );
                                                }
                                                return <span className={styles.statusBadge}>Awaiting admin approval</span>;
                                            } } ,
                                        ]}
                                        rows={purchaseOrders}
                                        emptyMessage="No purchase orders have been created for this store."
                                    />
                                                                    {showCreateOrderForm && (
                                        <form className={styles.employeeForm} onSubmit={(event) => {
                                            event.preventDefault();
                                            createPurchaseOrder();
                                        }}>
                                            <label>
                                                Product<select name="product_id" value={newOrderProductId} onChange={(event) => setNewOrderProductId(event.target.value)} required>
                                                    <option value="" disabled>Select product</option>
                                                    {products.map((product) => (
                                                        <option key={product.id} value={product.id}>
                                                            {product.name} ({product.sku}) — ₱{Number(product.selling_price).toFixed(2)} — Stock: {product.current_stock}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label>
                                                Quantity<input name="quantity" type="number" min="1" value={newOrderQuantity} onChange={(event) => setNewOrderQuantity(event.target.value)} required />
                                            </label>
                                            {actionError && <p className={`${styles.formFeedback}`} role="alert">{actionError}</p>}
                                            <button className={styles.approveButton} type="submit" disabled={creatingOrder || !newOrderProductId || !newOrderQuantity}>
                                                {creatingOrder ? 'Creating…' : 'Create Order'}
                                            </button>
                                            <button type="button" className={styles.textAction} onClick={() => setShowCreateOrderForm(false)}>Cancel</button>
                                        </form>
                                    )}
                                </section>
                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}><div className={styles.cardTitle}>Demand forecasts</div></div>
                                    <DataTable
                                        columns={[
                                            { key: 'forecast_date', label: 'Date', render: (forecast) => new Date(`${forecast.forecast_date}T00:00:00`).toLocaleDateString() },
                                            { key: 'product_id', label: 'Product', render: (forecast) => productNames.get(forecast.product_id) || 'Product' },
                                            { key: 'predicted_demand', label: 'Predicted demand' },
                                            { key: 'confidence_score', label: 'Confidence', render: (forecast) => forecast.confidence_score == null ? '—' : `${forecast.confidence_score}%` },
                                            { key: 'is_anomaly', label: 'Anomaly', render: (forecast) => forecast.is_anomaly ? 'Yes' : 'No' },
                                        ]}
                                        rows={forecasts}
                                        emptyMessage="No upcoming forecasts have been generated."
                                    />
                                </section>
                            </div>
                        )}

                        {activeTab === 'staff' && (
                            <>
                                {profile?.role === 'admin' && (
                                    <EmployeeForm
                                        stores={[{ id: profile.store_id, name: storeName }]}
                                        onCreated={() => setRefreshKey((current) => current + 1)}
                                    />
                                )}
                                <section className={`${styles.card} ${styles.wideCard}`}>
                                    <div className={styles.cardHeader}><div className={styles.cardTitle}>Staff assigned to {storeName}</div></div>
                                    <DataTable
                                        columns={[
                                            { key: 'full_name', label: 'Name' },
                                            { key: 'username', label: 'Username', render: (member) => member.username || '—' },
                                            { key: 'role', label: 'Role' },
                                            { key: 'is_active', label: 'Status', render: (member) => <span className={styles.statusBadge}>{member.is_active ? 'Active' : 'Inactive'}</span> },
                                            { key: 'created_at', label: 'Added', render: (member) => dateTime(member.created_at) },
                                        ]}
                                        rows={staff}
                                        emptyMessage="No staff profiles are assigned to this store."
                                    />
                                </section>
                            </>
                        )}

                        {activeTab === 'financials' && (
                            <section className={`${styles.card} ${styles.wideCard}`}>
                                <div className={styles.cardHeader}><div className={styles.cardTitle}>Completed sales · last 30 days</div></div>
                                <DataTable
                                    columns={[
                                        { key: 'receipt_number', label: 'Receipt' },
                                        { key: 'created_at', label: 'Date', render: (sale) => dateTime(sale.created_at) },
                                        { key: 'payment_method', label: 'Payment' },
                                        { key: 'tax_amount', label: 'Tax', render: (sale) => money(sale.tax_amount) },
                                        { key: 'total_amount', label: 'Total', render: (sale) => money(sale.total_amount) },
                                    ]}
                                    rows={sales}
                                    emptyMessage="No completed sales have been recorded in the last 30 days."
                                />
                            </section>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
