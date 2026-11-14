'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Papa from 'papaparse';
import { useRouter } from 'next/navigation';
import InteractiveParticles from '../../../components/InteractiveParticles';
import { getSupabaseClient } from '../../../lib/supabase/client';
import RevenueTrend from '../../../components/RevenueTrend';
import ForecastEngine from '../../../components/ForecastEngine';
import EmployeeForm from '../manager/EmployeeForm';
import styles from './admin.module.css';

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const money = (value) => currency.format(Number(value) || 0);
const dateTime = (value) => value ? new Date(value).toLocaleString() : 'No heartbeat';
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const navigation = [
    { id: 'overview', label: 'Store Overview', icon: 'fa-chart-pie' },
    { id: 'staff', label: 'Staff Management', icon: 'fa-users' },
    { id: 'inventory', label: 'Inventory', icon: 'fa-boxes' },
    { id: 'suppliers', label: 'Store Suppliers', icon: 'fa-truck' },
    { id: 'reports', label: 'Sales & Reports', icon: 'fa-chart-line' },
    { id: 'payments', label: 'Payments', icon: 'fa-qrcode' },
    { id: 'security', label: 'Security & Audit', icon: 'fa-shield-alt' },
    { id: 'settings', label: 'Store Settings', icon: 'fa-sliders-h' },
];
function DataTable({ columns, rows, emptyMessage, className = '', columnWidths }) {
    if (!rows.length) return <p className={styles.emptyState}>{emptyMessage}</p>;

    return (
        <div className={styles.tableWrap}>
            <table className={`${styles.dataTable} ${className}`}>
                {columnWidths && <colgroup>{columnWidths.map((width, index) => <col key={columns[index].key} style={width ? { width } : undefined} />)}</colgroup>}
                <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id ?? row.key}>
                            {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function AdminWorkspace() {
    const router = useRouter();
    const [activeSection, setActiveSection] = useState('overview');
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
    const sidebarRef = useRef(null);
    const [profile, setProfile] = useState(null);
    const [stores, setStores] = useState([]);
    const [staff, setStaff] = useState([]);
    const [products, setProducts] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [orderError, setOrderError] = useState('');
    const [approvingOrder, setApprovingOrder] = useState('');
    const [sales, setSales] = useState([]);
    const [highRiskSales, setHighRiskSales] = useState([]);
    const [devices, setDevices] = useState([]);
    const [mlStatus, setMlStatus] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [metrics, setMetrics] = useState(null);
    const [simulatedPayments, setSimulatedPayments] = useState([]);
    const [simulatedPaymentMetrics, setSimulatedPaymentMetrics] = useState(null);
    const [simulatedPaymentCount, setSimulatedPaymentCount] = useState(0);
    const [simulatedPaymentPage, setSimulatedPaymentPage] = useState(1);
    const [simulatedPaymentLoading, setSimulatedPaymentLoading] = useState(false);
    const [simulatedPaymentError, setSimulatedPaymentError] = useState('');
    const [simulatedPaymentFilters, setSimulatedPaymentFilters] = useState({ status: '', method: '', reference: '', from: '', to: '' });
    const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', leadTime: '0' });
    const [productForm, setProductForm] = useState(null);
    const [selectedProductImage, setSelectedProductImage] = useState('');
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
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
            setNotice('');

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
                    .select('id, full_name, username, role, store_id, is_active, permission_overrides')
                    .eq('id', user.id)
                    .maybeSingle();
                if (profileError) throw profileError;
                if (currentProfile?.role !== 'admin' || !currentProfile.is_active) {
                    router.replace(currentProfile?.role === 'manager' ? '/dashboard/manager' : '/dashboard');
                    return;
                }
                const storeId = currentProfile.store_id;
                if (!storeId) throw new Error('Your administrator account is not assigned to a store. Contact support.');

                const storesQuery = supabase.from('stores').select('id, name, location, tax_rate, created_at').eq('id', storeId);
                const profilesQuery = supabase.from('profiles').select('id, full_name, username, role, permission_overrides, is_active, store_id, created_at').eq('store_id', storeId).order('full_name');
                const productsQuery = supabase.rpc('admin_global_products');
                const salesQuery = supabase.from('sales').select('id, store_id, cashier_id, receipt_number, total_amount, tax_amount, payment_method, status, created_at').eq('store_id', storeId).eq('status', 'completed').order('created_at', { ascending: false }).limit(500);
                const highRiskSalesQuery = supabase.from('sales').select('id, store_id, cashier_id, receipt_number, total_amount, payment_method, status, created_at').eq('store_id', storeId).in('status', ['voided', 'refunded']).order('created_at', { ascending: false }).limit(100);
                const salesForecastsQuery = supabase.from('sales_forecasts').select('id, forecast_date, predicted_sales, confidence_score, actual_sales, variance_percent').order('forecast_date', { ascending: true }).limit(30);
                const stockAlertsQuery = supabase.from('stock_shortage_alerts').select('*').order('days_until_shortage', { ascending: true, nullsFirst: false }).limit(20);

                const results = await Promise.all([
                    supabase.rpc('admin_global_metrics'),
                    storesQuery,
                    profilesQuery,
                    productsQuery,
                    salesQuery,
                    highRiskSalesQuery,
                    supabase.from('pos_devices').select('id, store_id, name, device_type, last_seen_at, pending_sync_count').eq('store_id', storeId).order('last_seen_at', { ascending: false }),
                    supabase.from('ml_engine_status').select('id, model_name, status, confidence_score, updated_at, details').eq('store_id', storeId).order('updated_at', { ascending: false }),
                    supabase.from('suppliers').select('id, name, contact_name, email, phone, lead_time_days, api_configured, is_active').eq('store_id', storeId).order('name'),
                    supabase.from('audit_logs').select('id, actor_id, store_id, action, entity_table, entity_id, changed_at, before_data, after_data').eq('store_id', storeId).order('changed_at', { ascending: false }).limit(200),
                    salesForecastsQuery,
                    stockAlertsQuery,
                    supabase.from('purchase_orders').select('id, store_id, product_id, suggested_quantity, status, approved_by, created_at').eq('store_id', storeId).order('created_at', { ascending: false }).limit(100),
                ]);
                const failed = results.find((result) => result.error);
                if (failed) throw failed.error;
                if (!isCurrent) return;

                const [metricRow] = results[0].data || [];
                setProfile(currentProfile);
                setCurrentTime(Date.now());
                setMetrics(metricRow || null);
                setStores(results[1].data || []);
                setStaff(results[2].data || []);
                setProducts(results[3].data || []);
                setSales(results[4].data || []);
                setHighRiskSales(results[5].data || []);
                setDevices(results[6].data || []);
                setMlStatus(results[7].data || []);
                setSuppliers(results[8].data || []);
                setAuditLogs(results[9].data || []);
                setSalesForecasts(results[10].data || []);
                setStockAlerts(results[11].data || []);
                setPurchaseOrders(results[12].data || []);
            } catch (loadError) {
                if (isCurrent) setError(loadError.message || 'Unable to load store data.');
            } finally {
                if (isCurrent) setLoading(false);
            }
        };

        loadDashboard();
        return () => { isCurrent = false; };
    }, [refreshKey, router]);

    useEffect(() => {
        if (activeSection !== 'payments' || !profile?.store_id) return undefined;
        let isCurrent = true;
        const loadPayments = async () => {
            setSimulatedPaymentLoading(true);
            setSimulatedPaymentError('');
            try {
                const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
                if (sessionError) throw sessionError;
                if (!session) throw new Error('Your session expired. Sign in again.');
                const params = new URLSearchParams({ page: String(simulatedPaymentPage) });
                Object.entries(simulatedPaymentFilters).forEach(([key, value]) => {
                    if (value) params.set(key, value);
                });
                const response = await fetch(`/api/admin/simulated-payments?${params}`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                    cache: 'no-store',
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Unable to load payments.');
                if (!isCurrent) return;
                setSimulatedPayments(result.payments || []);
                setSimulatedPaymentMetrics(result.metrics || null);
                setSimulatedPaymentCount(result.count || 0);
            } catch (paymentLoadError) {
                if (isCurrent) setSimulatedPaymentError(paymentLoadError.message || 'Unable to load payments.');
            } finally {
                if (isCurrent) setSimulatedPaymentLoading(false);
            }
        };
        loadPayments();
        return () => { isCurrent = false; };
    }, [activeSection, profile?.store_id, refreshKey, simulatedPaymentFilters, simulatedPaymentPage]);

    useEffect(() => {
        if (!profile?.store_id) return;
        let current = true;
        const refreshOrders = async () => {
            const { data, error: loadError } = await getSupabaseClient().from('purchase_orders')
                .select('id, store_id, product_id, suggested_quantity, status, approved_by, created_at')
                .eq('store_id', profile.store_id).order('created_at', { ascending: false }).limit(100);
            if (current) {
                if (loadError) setOrderError(loadError.message);
                else { setPurchaseOrders(data || []); setOrderError(''); }
            }
        };
        const timer = window.setInterval(refreshOrders, 15000);
        return () => { current = false; window.clearInterval(timer); };
    }, [profile?.store_id]);

    const approvePurchaseOrder = async (order) => {
        setApprovingOrder(order.id);
        setOrderError('');
        try {
            const { data, error: approvalError } = await getSupabaseClient().from('purchase_orders')
                .update({ status: 'approved', approved_by: profile.id, updated_at: new Date().toISOString() })
                .eq('id', order.id).eq('store_id', profile.store_id).eq('status', 'pending_approval')
                .select('id, store_id, product_id, suggested_quantity, status, approved_by, created_at').single();
            if (approvalError) throw approvalError;
            setPurchaseOrders((orders) => orders.map((entry) => entry.id === data.id ? data : entry));
        } catch (failure) { setOrderError(failure.message || 'Unable to approve this order. Refresh and try again.'); }
        finally { setApprovingOrder(''); }
    };
    const pendingOrderCount = purchaseOrders.filter((order) => order.status === 'pending_approval').length;

    const storeNames = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
    const profileNames = useMemo(() => new Map(staff.map((member) => [member.id, member.full_name])), [staff]);


    const getAdminSession = async () => {
        const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('Your session expired. Sign in again.');
        return session;
    };

    const runAction = async (label, action) => {
        setBusy(label);
        setError('');
        setNotice('');
        try {
            await action();
            setNotice('Saved successfully.');
        } catch (actionError) {
            setError(actionError.message || 'Unable to save this change.');
        } finally {
            setBusy('');
        }
    };

    const saveTaxRate = async (storeId, taxRate) => runAction(`tax-${storeId}`, async () => {
        const { error: updateError } = await getSupabaseClient()
            .from('stores')
            .update({ tax_rate: Number(taxRate) / 100 })
            .eq('id', storeId);
        if (updateError) throw updateError;
        setStores((current) => current.map((store) => store.id === storeId ? { ...store, tax_rate: Number(taxRate) / 100 } : store));
    });

    const generateForecasts = async () => {
        setGeneratingForecast(true);

        try {
            const supabase = getSupabaseClient();
            const { error: rpcError } = await supabase.rpc('generate_forecasts', {
                p_store_id: profile.store_id,
            });

            if (rpcError) throw rpcError;

            setRefreshKey((current) => current + 1);
        } catch (rpcError) {
            setError(rpcError.message || 'Unable to generate forecasts.');
        } finally {
            setGeneratingForecast(false);
        }
    };

    const saveProduct = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await runAction('product', async () => {
            const formData = new FormData(form);
            const imageFile = formData.get('image');
            const removeImage = formData.get('remove_image') === 'on';
            if (imageFile?.size && (!['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type) || imageFile.size > 5 * 1024 * 1024)) {
                throw new Error('Choose a JPG, PNG, or WebP image up to 5 MB.');
            }
            const row = {
                p_id: productForm?.id || null,
                p_sku: String(formData.get('sku')).trim(),
                p_name: String(formData.get('name')).trim(),
                p_category: String(formData.get('category')).trim() || null,
                p_cost_price: Number(formData.get('cost_price')),
                p_selling_price: Number(formData.get('selling_price')),
                p_current_stock: Number.parseInt(formData.get('current_stock'), 10),
                p_store_id: profile.store_id,
                p_is_archived: false,
            };
            const supabase = getSupabaseClient();
            let productId;
            let saveError;
            if (profile.role === 'admin') {
                ({ data: productId, error: saveError } = await supabase.rpc('admin_save_product', row));
            } else {
                const productRow = {
                    sku: row.p_sku,
                    name: row.p_name,
                    category: row.p_category,
                    cost_price: row.p_cost_price,
                    selling_price: row.p_selling_price,
                    current_stock: row.p_current_stock,
                    store_id: row.p_store_id,
                    is_archived: row.p_is_archived,
                };
                const result = productForm?.id
                    ? await supabase.from('products').update(productRow).eq('id', productForm.id).eq('store_id', profile.store_id).select('id').single()
                    : await supabase.from('products').insert(productRow).select('id').single();
                productId = result.data?.id;
                saveError = result.error;
            }
            if (saveError) throw saveError;
            setProductForm((current) => ({ ...current, id: productId }));
            if (imageFile?.size) {
                const imagePath = `${productId}/image`;
                const { error: uploadError } = await supabase.storage.from('product-images').upload(imagePath, imageFile, {
                    cacheControl: '3600',
                    contentType: imageFile.type,
                    upsert: true,
                });
                if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
                const imageUrl = `${supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl}?v=${Date.now()}`;
                const { error: imageError } = await supabase.rpc('set_product_image_url', {
                    p_product_id: productId,
                    p_image_url: imageUrl,
                });
                if (imageError) throw new Error(`Photo uploaded, but saving its product link failed: ${imageError.message}`);
            } else if (removeImage && productForm.image_url) {
                const { error: imageError } = await supabase.rpc('set_product_image_url', {
                    p_product_id: productId,
                    p_image_url: null,
                });
                if (imageError) throw new Error(`Removing the product photo link failed: ${imageError.message}`);
                const { error: removeError } = await supabase.storage.from('product-images').remove([`${productId}/image`]);
                if (removeError) throw removeError;
            }
            setProductForm(null);
            setSelectedProductImage('');
            setRefreshKey((current) => current + 1);
        });
    };

    const deleteProduct = async (product) => {
        if (!window.confirm(`Permanently delete ${product.name}? Historical sales will be retained.`)) return;
        await runAction(`product-${product.id}`, async () => {
            const supabase = getSupabaseClient();
            if (product.image_url) {
                const { error: imageError } = await supabase.storage.from('product-images').remove([`${product.id}/image`]);
                if (imageError) throw imageError;
            }
            const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id);
            if (deleteError) throw deleteError;
            setProducts((current) => current.filter((item) => item.id !== product.id));
        });
    };

    const exportProducts = () => {
        const csv = Papa.unparse(products.map((product) => ({
            sku: product.sku,
            name: product.name,
            category: product.category || '',
            cost_price: product.cost_price,
            selling_price: product.selling_price,
            current_stock: product.current_stock,
            store_id: product.store_id,
        })));
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'predictpos-products.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportSales = () => {
        const csv = Papa.unparse(sales.map((sale) => ({
            receipt_number: sale.receipt_number,
            created_at: sale.created_at,
            store: storeNames.get(sale.store_id) || '',
            payment_method: sale.payment_method,
            tax_amount: sale.tax_amount,
            total_amount: sale.total_amount,
        })));
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'predictpos-sales-latest-500.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportSimulatedPayments = async () => {
        setSimulatedPaymentError('');
        try {
            const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');
            const params = new URLSearchParams({ export: 'true' });
            Object.entries(simulatedPaymentFilters).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });
            const response = await fetch(`/api/admin/simulated-payments?${params}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
                cache: 'no-store',
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to export payments.');
            const csv = Papa.unparse(result.payments.map((payment) => ({
                transaction_reference: payment.transaction_reference,
                receipt_number: payment.receipt_number || '',
                created_at: payment.created_at,
                completed_at: payment.completed_at || '',
                payment_method: payment.payment_method.toUpperCase(),
                amount_php: payment.amount,
                status: payment.status === 'paid_simulated' ? 'Paid' : payment.status,
                failure_reason: payment.failure_reason || '',
                disclosure: 'Test transaction',
            })));
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'predictpos-test-payments.csv';
            link.click();
            URL.revokeObjectURL(url);
        } catch (exportError) {
            setSimulatedPaymentError(exportError.message || 'Unable to export payments.');
        }
    };

    const importProducts = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!profile?.store_id) {
            setError('Your account is not assigned to a store. Contact an administrator.');
            return;
        }

        await runAction('import', async () => {
            const parsed = Papa.parse(file, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim().toLowerCase() });
            if (parsed.errors.length) throw new Error(parsed.errors[0].message);
            const importedProducts = parsed.data.map((row) => ({
                sku: String(row.sku || '').trim(),
                name: String(row.name || '').trim(),
                category: String(row.category || '').trim() || null,
                cost_price: Number(row.cost_price),
                selling_price: Number(row.selling_price),
                current_stock: Number.parseInt(row.current_stock, 10),
                is_archived: false,
            }));
            if (!importedProducts.length || importedProducts.some((product) => (
                !product.sku || !product.name || !Number.isFinite(product.cost_price) ||
                !Number.isFinite(product.selling_price) || !Number.isInteger(product.current_stock)
            ))) {
                throw new Error('CSV needs sku, name, cost_price, selling_price, and integer current_stock columns.');
            }
            const supabase = getSupabaseClient();
            const { error: importError } = await supabase.rpc('admin_import_products', {
                p_store_id: profile.store_id,
                p_products: importedProducts.map(({ sku, name, category, cost_price, selling_price, current_stock }) => ({
                    sku, name, category, cost_price, selling_price, current_stock,
                })),
            });
            if (importError) throw importError;
            setNotice(`${importedProducts.length} catalog rows imported.`);
            setRefreshKey((current) => current + 1);
        });
    };

    const createSupplier = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await runAction('supplier', async () => {
            const { error: insertError } = await getSupabaseClient().from('suppliers').insert({
                name: supplierForm.name.trim(),
                store_id: profile.store_id,
                contact_name: supplierForm.contactName.trim() || null,
                email: supplierForm.email.trim() || null,
                phone: supplierForm.phone.trim() || null,
                lead_time_days: Number(supplierForm.leadTime) || 0,
            });
            if (insertError) throw insertError;
            form.reset();
            setSupplierForm({ name: '', contactName: '', email: '', phone: '', leadTime: '0' });
            setRefreshKey((current) => current + 1);
        });
    };

    const updateEmployee = async (member, changes) => {
        if (changes.action === 'delete' && !window.confirm(`Permanently delete ${member.full_name}'s account? This cannot be undone.`)) return;
        await runAction(`employee-${member.id}`, async () => {
            const session = await getAdminSession();
            const response = await fetch('/api/admin/employees', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ id: member.id, ...changes }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to update account.');
            setRefreshKey((current) => current + 1);
        });
    };

    const handleLogout = async () => {
        await getSupabaseClient().auth.signOut();
        router.replace('/');
    };

    const latestMlStatus = mlStatus[0];
    const onlineDevices = devices.filter((device) => device.last_seen_at && currentTime - new Date(device.last_seen_at).getTime() < 5 * 60 * 1000).length;
    const pendingSync = devices.reduce((sum, device) => sum + Number(device.pending_sync_count || 0), 0);
    const recentRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
    const activeStaffCount = staff.filter((member) => member.is_active).length;
    const title = navigation.find((item) => item.id === activeSection)?.label || 'Store Overview';
    const initials = (profile?.full_name || 'Admin').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

    return (
        <div className={`${styles.container} dashboard-glass-buttons`}>
            <aside ref={sidebarRef} className={styles.sidebar}>
                <InteractiveParticles />
                <div className={styles.sidebarHeader}>
                    <div className={styles.logo}><Image src="/logos/android-chrome-192x192.png" alt="" className={styles.logoIcon} width={48} height={48} /><span className={styles.logoText}>redictPOS</span></div>
                    <button
                        className={styles.navToggle}
                        type="button"
                        onClick={() => setIsNavigationOpen((open) => !open)}
                        aria-label={isNavigationOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={isNavigationOpen}
                        aria-controls="admin-navigation-popover"
                        title={isNavigationOpen ? 'Close navigation' : 'Open navigation'}
                    >
                        <span className={`${styles.menuGlyph} ${isNavigationOpen ? styles.menuGlyphOpen : ''}`} aria-hidden="true"><span /></span>
                    </button>
                </div>
                <div id="admin-navigation-popover" className={`${styles.navPopover} ${isNavigationOpen ? styles.navPopoverOpen : ''}`}>
                        <nav className={styles.navLinks} aria-label="Administrator navigation">
                            {navigation.map((item) => (
                                <button key={item.id} type="button" className={`${styles.navItem} ${activeSection === item.id ? styles.active : ''}`} onClick={() => {
                                    setActiveSection(item.id);
                                    setIsNavigationOpen(false);
                                }}>
                                    <i className={`fas ${item.icon}`} aria-hidden="true" /> {item.label}{item.id === 'inventory' && pendingOrderCount > 0 && <span className={styles.pendingOrderBadge}>{pendingOrderCount} pending</span>}
                                </button>
                            ))}
                        </nav>
                        <div className={styles.userProfile}>
                            <div className={styles.userAvatar}>{initials}</div>
                            <div className={styles.userInfo}><h4>{profile?.full_name || 'Administrator'}</h4><p>Administrator</p></div>
                            <button className={styles.logoutButton} type="button" onClick={handleLogout} aria-label="Log out" title="Log out"><i className="fas fa-sign-out-alt" aria-hidden="true" /><span>Log out</span></button>
                        </div>
                </div>
            </aside>

            <main className={styles.mainContent}>
                <header className={styles.header}>
                    <div><p className={styles.storeLabel}>PREDICTPOS · {storeNames.get(profile?.store_id) || 'YOUR STORE'}</p><h1>{title}</h1></div>
                    <div className={styles.headerActions}>
                        <span className={styles.dateDisplay}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                        <button className={styles.refreshBtn} type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}><i className="fas fa-sync-alt" /> Refresh</button>
                    </div>
                </header>

                {error && <div className={styles.errorState} role="alert">{error}</div>}
                {notice && <div className={styles.noticeState} role="status">{notice}</div>}
                {loading ? <div className={styles.loadingState} role="status">Loading store data…</div> : !error && (
                    <>
                        {activeSection === 'overview' && (
                            <>
                                <div className={styles.metricGrid}>
                                    <section className={styles.metricCard}><span>Gross sales · all time</span><strong>{metrics ? money(metrics.gross_revenue) : '—'}</strong><small>Completed sales, including tax collected</small></section>
                                    <section className={styles.metricCard}><span>Estimated net profit</span><strong>{metrics ? money(metrics.net_profit) : '—'}</strong><small>{Number(metrics?.profit_coverage_sales || 0).toLocaleString()} sales with complete cost records</small></section>
                                    <section className={styles.metricCard}><span>Completed transactions</span><strong>{Number(metrics?.completed_sales || 0).toLocaleString()}</strong><small>This store</small></section>
                                    <section className={styles.metricCard}><span>Active staff</span><strong>{activeStaffCount.toLocaleString()}</strong><small>Accounts assigned to this store</small></section>
                                </div>

                                <div className={styles.overviewGrid}>
                                    <RevenueTrend sales={sales} />
                                    <ForecastEngine forecasts={salesForecasts} alerts={stockAlerts} onRefresh={generateForecasts} busy={generatingForecast} />
                                    <section className={styles.panel}>
                                        <div className={styles.panelHeading}><div><h2>Store terminals</h2><p>Devices seen in the last five minutes</p></div><strong className={styles.networkCount}>{onlineDevices}/{devices.length}</strong></div>
                                        <div className={styles.deviceSummary}><span>{pendingSync} pending sync records</span><span>{devices.length - onlineDevices} offline or unreported</span></div>
                                        <DataTable columns={[{ key: 'name', label: 'Device' }, { key: 'store_id', label: 'Location', render: (device) => storeNames.get(device.store_id) || 'Unknown' }, { key: 'last_seen_at', label: 'Last seen', render: (device) => dateTime(device.last_seen_at) }, { key: 'pending_sync_count', label: 'Pending' }]} rows={devices.slice(0, 6)} emptyMessage="No POS devices have registered a heartbeat yet." />
                                    </section>
                                    <section className={styles.panel}>
                                        <div className={styles.panelHeading}><div><h2>Your location</h2><p>Store details and tax rate</p></div><button type="button" className={styles.inlineLink} onClick={() => setActiveSection('settings')}>Store settings</button></div>
                                        <DataTable columns={[{ key: 'name', label: 'Store' }, { key: 'location', label: 'Location' }, { key: 'tax_rate', label: 'Tax', render: (store) => `${(Number(store.tax_rate) * 100).toFixed(2)}%` }]} rows={stores.slice(0, 6)} emptyMessage="No stores are registered." />
                                    </section>
                                </div>
                            </>
                        )}

                        {activeSection === 'staff' && (
                            <div className={styles.sectionStack}>
                                <EmployeeForm stores={stores} fixedStoreId={profile?.store_id} onCreated={() => setRefreshKey((current) => current + 1)} />
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Users & permissions</h2><p>Accounts, store scope, role overrides, and access status</p></div></div>
                                    <DataTable
                                        columns={[
                                            { key: 'full_name', label: 'Employee' },
                                            { key: 'username', label: 'Username' },
                                            { key: 'role', label: 'Role', render: (member) => <span className={styles.roleBadge}>{member.role}</span> },
                                            { key: 'store_id', label: 'Store', render: (member) => storeNames.get(member.store_id) || 'Unassigned' },
                                            { key: 'is_active', label: 'Account', render: (member) => <span className={member.is_active ? styles.activeBadge : styles.inactiveBadge}>{member.is_active ? 'Active' : 'Inactive'}</span> },
                                            { key: 'refunds_without_pin', label: 'Refunds', render: (member) => member.role === 'cashier' ? <input type="checkbox" aria-label={`Allow cashier PIN refunds for ${member.full_name}`} checked={Boolean(member.permission_overrides?.refunds_without_pin)} onChange={(event) => updateEmployee(member, { action: 'permission', permission: 'refunds_without_pin', enabled: event.target.checked })} /> : '—' },
                                            { key: 'manual_discounts', label: 'Discounts', render: (member) => member.role === 'cashier' ? <input type="checkbox" aria-label={`Allow manual discounts for ${member.full_name}`} checked={Boolean(member.permission_overrides?.manual_discounts)} onChange={(event) => updateEmployee(member, { action: 'permission', permission: 'manual_discounts', enabled: event.target.checked })} /> : '—' },
                                            { key: 'void_sales', label: 'Void sales', render: (member) => member.role === 'cashier' ? <input type="checkbox" aria-label={`Allow voids for ${member.full_name}`} checked={Boolean(member.permission_overrides?.void_sales)} onChange={(event) => updateEmployee(member, { action: 'permission', permission: 'void_sales', enabled: event.target.checked })} /> : '—' },
                                            { key: 'account_action', label: 'Access', render: (member) => member.role !== 'admin' ? <button className={styles.textAction} type="button" onClick={() => updateEmployee(member, { action: 'delete' })}>Delete</button> : '—' },
                                        ]}
                                        rows={staff}
                                        emptyMessage="No staff accounts are registered."
                                    />
                                    <p className={styles.panelFootnote}>Deleting permanently removes the staff login and profile. Sales history is retained without the staff account association.</p>
                                    <p className={styles.panelFootnote}>Cashiers with void permission can approve voids with their PIN. Item refunds use a cashier PIN when refund permission is enabled; otherwise a manager PIN is required. Discount permission enables percentage discounts at checkout.</p>
                                </section>
                            </div>
                        )}

                        {activeSection === 'inventory' && (
                            <div className={styles.sectionStack}>
                                <section className={styles.panel} aria-label="Purchase orders">
                                    <div className={styles.panelHeading}><div><h2>Purchase orders</h2><p>{pendingOrderCount} pending approval</p></div></div>
                                    {orderError && <p className={styles.errorState} role="alert">{orderError}</p>}
                                    <DataTable className={styles.inventoryTable} columnWidths={['18%', '64px', null, '8%', '20%', '136px']} columns={[
                                        { key: 'created_at', label: 'Created', render: (order) => dateTime(order.created_at) },
                                        { key: 'photo', label: 'Photo', render: (order) => {
                                            const product = products.find((item) => item.id === order.product_id);
                                            return product?.image_url ? <Image src={product.image_url} alt={`${product.name} product`} width={42} height={42} unoptimized className={styles.productThumbnail} /> : <span className={styles.orderPhotoPlaceholder} aria-label="No product photo"><i className="fas fa-box" aria-hidden="true" /></span>;
                                        } },
                                        { key: 'product_id', label: 'Product', render: (order) => products.find((product) => product.id === order.product_id)?.name || 'Unavailable product' },
                                        { key: 'suggested_quantity', label: 'Quantity' },
                                        { key: 'status', label: 'Status', render: (order) => order.status === 'pending_approval' ? 'Pending approval' : order.status.replaceAll('_', ' ') },
                                        { key: 'action', label: 'Action', render: (order) => order.status === 'pending_approval' ? <button type="button" className={styles.primaryButton} disabled={Boolean(approvingOrder)} onClick={() => approvePurchaseOrder(order)}>{approvingOrder === order.id ? 'Approving…' : 'Approve order'}</button> : '—' },
                                    ]} rows={purchaseOrders} emptyMessage="No purchase orders for this store." />
                                </section>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Master SKU registry</h2><p>Products for your assigned store</p></div><div className={styles.toolbar}><button className={styles.secondaryButton} type="button" onClick={exportProducts}>Export CSV</button><label className={styles.fileButton}>Import CSV<input type="file" accept=".csv,text/csv" onChange={importProducts} /></label><button className={styles.primaryButton} type="button" onClick={() => { setSelectedProductImage(''); setProductForm({}); }}>Add product</button></div></div>
                                    <DataTable className={styles.inventoryTable} columnWidths={['9%', '64px', null, '10%', '10%', '10%', '6%', '10%', '136px']}
                                        columns={[
                                            { key: 'sku', label: 'SKU' }, { key: 'photo', label: 'Photo', render: (product) => product.image_url ? <Image src={product.image_url} alt={`${product.name} product`} width={42} height={42} unoptimized className={styles.productThumbnail} /> : '—' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' },
                                            { key: 'store_id', label: 'Store', render: (product) => storeNames.get(product.store_id) || 'Unknown' },
                                            { key: 'selling_price', label: 'Price', render: (product) => money(product.selling_price) }, { key: 'current_stock', label: 'Stock' },
                                            { key: 'is_archived', label: 'Status', render: (product) => product.is_archived ? 'Archived' : 'Active' },
                                            { key: 'actions', label: 'Actions', render: (product) => <div className={styles.rowActions}><button type="button" className={styles.textAction} onClick={() => { setSelectedProductImage(''); setProductForm(product); }}>Edit</button><button type="button" className={styles.textAction} onClick={() => deleteProduct(product)}>Delete</button></div> },
                                        ]}
                                        rows={products}
                                        emptyMessage="No products have been added to the master catalog."
                                    />
                                    <p className={styles.panelFootnote}>CSV import columns: sku, name, category, cost_price, selling_price, current_stock. Imported products are added to your assigned store.</p>
                                </section>
                                {productForm && (
                                    <section className={styles.panel}>
                                        <div className={styles.panelHeading}><div><h2>{productForm.id ? 'Edit product' : 'Add master product'}</h2></div><button className={styles.cancelButton} type="button" onClick={() => { setSelectedProductImage(''); setProductForm(null); }}>Cancel</button></div>
                                        <form className={styles.adminForm} onSubmit={saveProduct}>
                                            <label>SKU<input name="sku" defaultValue={productForm.sku || ''} maxLength={50} required /></label>
                                            <label>Product name<input name="name" defaultValue={productForm.name || ''} required /></label>
                                            <label>Category<input name="category" defaultValue={productForm.category || ''} /></label>
                                            <label>Cost price<input name="cost_price" type="number" min="0" step="0.01" defaultValue={productForm.cost_price || ''} required /></label>
                                            <label>Selling price<input name="selling_price" type="number" min="0" step="0.01" defaultValue={productForm.selling_price || ''} required /></label>
                                            <label>Stock<input name="current_stock" type="number" min="0" step="1" defaultValue={productForm.current_stock ?? 0} required /></label>
                                            <div className={styles.productPhotoField}>
                                                {selectedProductImage || productForm.image_url ? <Image src={selectedProductImage || productForm.image_url} alt={`${productForm.name || 'Selected'} product`} width={112} height={84} unoptimized className={styles.productPreview} /> : <span className={styles.photoPlaceholder}>No product photo</span>}
                                                <label className={styles.fileButton}>Choose product photo<input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                                                    const file = event.currentTarget.files?.[0];
                                                    if (!file) {
                                                        setSelectedProductImage('');
                                                        return;
                                                    }
                                                    const reader = new FileReader();
                                                    reader.onload = () => setSelectedProductImage(typeof reader.result === 'string' ? reader.result : '');
                                                    reader.readAsDataURL(file);
                                                }} /></label>
                                                {productForm.image_url && <label className={styles.removePhoto}><input name="remove_image" type="checkbox" /> Remove current photo</label>}
                                            </div>
                                            <button className={styles.primaryButton} type="submit" disabled={busy === 'product'}>{busy === 'product' ? 'Saving…' : 'Save product'}</button>
                                        </form>
                                    </section>
                                )}
                            </div>
                        )}

                        {activeSection === 'suppliers' && (
                            <div className={styles.sectionStack}>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Store supplier directory</h2><p>Vendor contacts for this store</p></div></div>
                                    <form className={styles.adminForm} onSubmit={createSupplier}>
                                        <label>Supplier name<input value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} required /></label>
                                        <label>Contact name<input value={supplierForm.contactName} onChange={(event) => setSupplierForm({ ...supplierForm, contactName: event.target.value })} /></label>
                                        <label>Email<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></label>
                                        <label>Phone<input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label>
                                        <label>Lead time · days<input type="number" min="0" value={supplierForm.leadTime} onChange={(event) => setSupplierForm({ ...supplierForm, leadTime: event.target.value })} /></label>
                                        <button className={styles.primaryButton} type="submit" disabled={busy === 'supplier'}>{busy === 'supplier' ? 'Saving…' : 'Add supplier'}</button>
                                    </form>
                                </section>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Store suppliers</h2></div></div>
                                    <DataTable columns={[{ key: 'name', label: 'Supplier' }, { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'lead_time_days', label: 'Lead time' }, { key: 'api_configured', label: 'API', render: (supplier) => supplier.api_configured ? 'Configured' : 'Not connected' }]} rows={suppliers} emptyMessage="No suppliers are registered." />
                                </section>
                            </div>
                        )}

                        {activeSection === 'reports' && (
                            <div className={styles.sectionStack}>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Sales ledger</h2><p>Latest completed transactions for this store</p></div><div className={styles.toolbar}><button className={styles.secondaryButton} type="button" onClick={exportSales}>Export CSV</button></div></div>
                                    <DataTable columns={[{ key: 'receipt_number', label: 'Receipt' }, { key: 'created_at', label: 'Date', render: (sale) => dateTime(sale.created_at) }, { key: 'store_id', label: 'Store', render: (sale) => storeNames.get(sale.store_id) || 'Unknown' }, { key: 'payment_method', label: 'Payment' }, { key: 'tax_amount', label: 'Tax', render: (sale) => money(sale.tax_amount) }, { key: 'total_amount', label: 'Total', render: (sale) => money(sale.total_amount) }]} rows={sales} emptyMessage="No completed sales have been recorded." />
                                </section>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>High-risk transactions</h2><p>Refunded or voided sales requiring review</p></div></div>
                                    <DataTable columns={[{ key: 'receipt_number', label: 'Receipt' }, { key: 'created_at', label: 'Date', render: (sale) => dateTime(sale.created_at) }, { key: 'store_id', label: 'Store', render: (sale) => storeNames.get(sale.store_id) || 'Unknown' }, { key: 'status', label: 'Status' }, { key: 'total_amount', label: 'Amount', render: (sale) => money(sale.total_amount) }]} rows={highRiskSales} emptyMessage="No voided or refunded sales are recorded." />
                                </section>
                            </div>
                        )}

                        {activeSection === 'payments' && (
                            <div className={styles.sectionStack}>
                                <div className={styles.metricGrid}>
                                    <section className={styles.metricCard}><span>Test payment total</span><strong>{money(simulatedPaymentMetrics?.simulated_revenue)}</strong><small>Test transactions only</small></section>
                                    <section className={styles.metricCard}><span>Successful</span><strong>{Number(simulatedPaymentMetrics?.successful_count || 0).toLocaleString()}</strong><small>Paid</small></section>
                                    <section className={styles.metricCard}><span>Pending</span><strong>{Number(simulatedPaymentMetrics?.pending_count || 0).toLocaleString()}</strong><small>Awaiting confirmation</small></section>
                                    <section className={styles.metricCard}><span>Failed</span><strong>{Number(simulatedPaymentMetrics?.failed_count || 0).toLocaleString()}</strong><small>Declined or invalid test attempts</small></section>
                                </div>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}>
                                        <div><h2>Payment ledger</h2><p>Test mode</p></div>
                                        <div className={styles.toolbar}>
                                            <button className={styles.secondaryButton} type="button" onClick={exportSimulatedPayments} disabled={simulatedPaymentLoading}>Export CSV</button>
                                            <button className={styles.secondaryButton} type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={simulatedPaymentLoading}>Refresh</button>
                                        </div>
                                    </div>
                                    <div className={styles.paymentFilters}>
                                        <label>Reference<input value={simulatedPaymentFilters.reference} onChange={(event) => { setSimulatedPaymentPage(1); setSimulatedPaymentFilters((current) => ({ ...current, reference: event.target.value })); }} placeholder="Search reference" /></label>
                                        <label>Status<select value={simulatedPaymentFilters.status} onChange={(event) => { setSimulatedPaymentPage(1); setSimulatedPaymentFilters((current) => ({ ...current, status: event.target.value })); }}><option value="">All statuses</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="paid_simulated">Paid</option><option value="failed">Failed</option><option value="canceled">Canceled</option><option value="expired">Expired</option></select></label>
                                        <label>Method<select value={simulatedPaymentFilters.method} onChange={(event) => { setSimulatedPaymentPage(1); setSimulatedPaymentFilters((current) => ({ ...current, method: event.target.value })); }}><option value="">All methods</option><option value="cash">Cash</option><option value="qrph">QRPH</option><option value="card">Card</option></select></label>
                                        <label>From<input type="date" value={simulatedPaymentFilters.from} onChange={(event) => { setSimulatedPaymentPage(1); setSimulatedPaymentFilters((current) => ({ ...current, from: event.target.value })); }} /></label>
                                        <label>To<input type="date" value={simulatedPaymentFilters.to} onChange={(event) => { setSimulatedPaymentPage(1); setSimulatedPaymentFilters((current) => ({ ...current, to: event.target.value })); }} /></label>
                                    </div>
                                    {simulatedPaymentError && <p className={styles.errorState} role="alert">{simulatedPaymentError}</p>}
                                    {simulatedPaymentLoading ? <p className={styles.loadingState}>Loading payments…</p> : (
                                        <DataTable
                                            columns={[
                                                { key: 'transaction_reference', label: 'Reference' },
                                                { key: 'receipt_number', label: 'Receipt' },
                                                { key: 'created_at', label: 'Created', render: (payment) => dateTime(payment.created_at) },
                                                { key: 'completed_at', label: 'Completed', render: (payment) => dateTime(payment.completed_at) },
                                                { key: 'payment_method', label: 'Method', render: (payment) => payment.payment_method.toUpperCase() },
                                                { key: 'amount', label: 'Amount · PHP', render: (payment) => money(payment.amount) },
                                                { key: 'status', label: 'Status', render: (payment) => <span className={payment.status === 'paid_simulated' ? styles.activeBadge : payment.status === 'failed' ? styles.inactiveBadge : styles.roleBadge}>{payment.status === 'paid_simulated' ? 'Paid' : payment.status}</span> },
                                                { key: 'failure_reason', label: 'Details', render: (payment) => payment.failure_reason || '—' },
                                            ]}
                                            rows={simulatedPayments}
                                            emptyMessage="No transactions match these filters."
                                        />
                                    )}
                                    <div className={styles.paymentPagination}>
                                        <span>{simulatedPaymentCount ? `${(simulatedPaymentPage - 1) * 50 + 1}–${Math.min(simulatedPaymentPage * 50, simulatedPaymentCount)} of ${simulatedPaymentCount}` : '0 transactions'}</span>
                                        <div>
                                            <button className={styles.secondaryButton} type="button" onClick={() => setSimulatedPaymentPage((page) => Math.max(1, page - 1))} disabled={simulatedPaymentPage <= 1 || simulatedPaymentLoading}>Previous</button>
                                            <button className={styles.secondaryButton} type="button" onClick={() => setSimulatedPaymentPage((page) => page + 1)} disabled={simulatedPaymentPage * 50 >= simulatedPaymentCount || simulatedPaymentLoading}>Next</button>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeSection === 'security' && (
                            <div className={styles.sectionStack}>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Store audit trail</h2><p>Recent changes recorded for this store</p></div></div>
                                    <DataTable columns={[{ key: 'changed_at', label: 'Timestamp', render: (entry) => dateTime(entry.changed_at) }, { key: 'actor_id', label: 'Actor', render: (entry) => profileNames.get(entry.actor_id) || 'System / service' }, { key: 'action', label: 'Action' }, { key: 'entity_table', label: 'Area' }, { key: 'entity_id', label: 'Record' }, { key: 'store_id', label: 'Store', render: (entry) => storeNames.get(entry.store_id) || 'Your store' }]} rows={auditLogs} emptyMessage="No critical changes have been logged for this store." />
                                </section>
                            </div>
                        )}

                        {activeSection === 'settings' && (
                            <div className={styles.sectionStack}>
                                <section className={styles.panel}>
                                    <div className={styles.panelHeading}><div><h2>Store details & tax rate</h2><p>Tax rates are entered as percentages and stored as decimal fractions</p></div></div>
                                    <DataTable columns={[{ key: 'name', label: 'Store' }, { key: 'location', label: 'Location' }, { key: 'tax_rate', label: 'Tax rate', render: (store) => <input className={styles.inlineNumber} aria-label={`Tax rate for ${store.name}`} type="number" min="0" max="99.99" step="0.01" defaultValue={(Number(store.tax_rate) * 100).toFixed(2)} onBlur={(event) => saveTaxRate(store.id, event.target.value)} /> }, { key: 'created_at', label: 'Added', render: (store) => dateTime(store.created_at) }]} rows={stores} emptyMessage="No stores are registered." />
                                </section>
                            </div>
                        )}
                    </>
                )}
            </main>

        </div>
    );
}
