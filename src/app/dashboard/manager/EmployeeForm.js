'use client';

import { useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase/client';
import styles from './manager.module.css';

export default function EmployeeForm({ stores = [], fixedStoreId, onCreated }) {
    const [feedback, setFeedback] = useState('');
    const [feedbackType, setFeedbackType] = useState('error');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [role, setRole] = useState('cashier');
    const [globalAccess, setGlobalAccess] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setIsSubmitting(true);
        setFeedback('');

        try {
            const supabase = getSupabaseClient();
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) throw new Error('Your session expired. Sign in again.');

            const formData = new FormData(form);
            const response = await fetch('/api/admin/employees', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    fullName: formData.get('full_name'),
                    username: formData.get('username'),
                    email: formData.get('email'),
                    password: formData.get('password'),
                    pin: formData.get('pin'),
                    role,
                    storeId: fixedStoreId || (globalAccess ? null : formData.get('store_id')),
                    globalAccess: fixedStoreId ? false : globalAccess,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to create the account.');

            form.reset();
            setRole('cashier');
            setGlobalAccess(false);
            setFeedbackType('success');
            setFeedback(result.message);
            onCreated();
        } catch (error) {
            setFeedbackType('error');
            setFeedback(error.message || 'Unable to create the employee account.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className={`${styles.card} ${styles.wideCard}`}>
            <div className={styles.cardHeader}><div className={styles.cardTitle}>Add a store employee</div></div>
            <form className={styles.employeeForm} onSubmit={handleSubmit}>
                <label>Full name<input name="full_name" type="text" autoComplete="name" maxLength={120} required /></label>
                <label>Username<input name="username" type="text" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]+" required /></label>
                <label>Email<input name="email" type="email" autoComplete="email" required /></label>
                <label>Temporary password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
                <label>Four-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required /></label>
                <label>Role<select name="role" value={role} onChange={(event) => { setRole(event.target.value); setGlobalAccess(false); }}><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label>
                {!fixedStoreId && role === 'manager' && stores.length > 1 && <label className={styles.globalAccessOption}><input type="checkbox" checked={globalAccess} onChange={(event) => setGlobalAccess(event.target.checked)} /> Global access across stores</label>}
                {!fixedStoreId && !globalAccess && <label>Store<select name="store_id" defaultValue="" required><option value="" disabled>Select store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
                {feedback && <p className={`${styles.formFeedback} ${feedbackType === 'success' ? styles.successFeedback : ''}`} role={feedbackType === 'error' ? 'alert' : 'status'}>{feedback}</p>}
                <button className={styles.approveButton} type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create employee account'}</button>
            </form>
        </section>
    );
}
