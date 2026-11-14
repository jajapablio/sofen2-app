import styles from './ForecastEngine.module.css';

const money = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);

export default function ForecastEngine({ forecasts, alerts, onRefresh, busy, disabled }) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dayKey = (offset) => {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        return date.toISOString().slice(0, 10);
    };
    const rows = forecasts.filter((row) => row.forecast_date > today && row.forecast_date <= dayKey(14));
    const tomorrow = rows.filter((row) => row.forecast_date === dayKey(1));
    const total = (days) => rows.filter((row) => row.forecast_date <= dayKey(days)).reduce((sum, row) => sum + Number(row.predicted_sales), 0);
    const complete = (days) => new Set(rows.filter((row) => row.forecast_date <= dayKey(days)).map((row) => row.forecast_date)).size === days;
    const confidence = tomorrow.length ? Math.min(...tomorrow.map((row) => Number(row.confidence_score))) : null;
    return (
        <section className={styles.panel} aria-label="Forecast engine">
            <header className={styles.header}><div><h2>Forecast engine</h2><p>Sales predictions · next 14 days</p></div></header>
            <div className={styles.metrics}>
                <div className={styles.metric}><span>Predicted tomorrow</span><strong>{tomorrow.length ? money(total(1)) : '—'}</strong><small>{confidence === null ? 'Awaiting sales history' : `${confidence}% confidence`}</small></div>
                <div className={styles.metric}><span>Next 7 days</span><strong>{complete(7) ? money(total(7)) : '—'}</strong><small>Projected revenue</small></div>
                <div className={styles.metric}><span>Next 14 days</span><strong>{complete(14) ? money(total(14)) : '—'}</strong><small>Two-week forecast</small></div>
            </div>
            <div className={styles.alerts}>
                <h3>{alerts.length ? `${alerts.length} stock shortage alert${alerts.length === 1 ? '' : 's'}` : 'Stock shortage alerts'}</h3>
                {alerts.length ? <ul>{alerts.slice(0, 5).map((alert) => <li key={alert.product_id}><strong>{alert.product_name}</strong>: restock {alert.suggested_restock} units ({alert.days_until_shortage === 0 ? 'now' : `${alert.days_until_shortage} days`})</li>)}</ul> : <p>{rows.length ? 'No predicted shortages in the next 7 days.' : 'Predictions will appear after completed sales are recorded.'}</p>}
            </div>
            <footer className={styles.footer}><small>Refreshes hourly · Estimates depend on sales history</small><button type="button" onClick={onRefresh} disabled={busy || disabled}>{busy ? 'Updating forecasts…' : 'Update forecast'}</button></footer>
        </section>
    );
}
