/** Server-only email delivery. Never return credentials or provider content to clients. */
export async function sendEmailJs(templateId, templateParams) {
    const { EMAILJS_SERVICE_ID: serviceId, EMAILJS_PUBLIC_KEY: publicKey, EMAILJS_PRIVATE_KEY: privateKey } = process.env;
    if (!templateId || !serviceId || !publicKey || !privateKey) throw new Error('Email delivery is not configured.');
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId, template_id: templateId, user_id: publicKey,
            accessToken: privateKey, template_params: templateParams }),
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        const detail = (await response.text()).toLowerCase();
        const reasons = [
            ['non-browser', 'enable_non_browser_requests'], ['private key', 'check_private_key'],
            ['public key', 'check_public_key'], ['user_id', 'check_public_key'],
            ['service', 'check_service_id_or_connection'], ['template', 'check_template_id'],
            ['recipient', 'check_template_recipient'], ['quota', 'emailjs_quota_exceeded'],
        ];
        const reason = reasons.find(([pattern]) => detail.includes(pattern))?.[1] || 'provider_rejected';
        console.error('EmailJS delivery rejected', { status: response.status, reason });
        throw new Error('Email delivery failed.');
    }
}
