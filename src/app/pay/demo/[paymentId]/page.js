import PaymentDemoPage from '../../../../components/PaymentDemoPage';

export default async function DemoPaymentRoute({ params }) {
    const { paymentId } = await params;
    return <PaymentDemoPage paymentId={paymentId} />;
}