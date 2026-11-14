import './globals.css';
import InstallApp from '../components/InstallApp';

export const metadata = {
  title: 'PredictPOS',
  applicationName: 'PredictPOS',
  appleWebApp: { capable: true, title: 'PredictPOS', statusBarStyle: 'default' },
  description: 'An automated point-of-sale and inventory control system using predictive analysis for sales forecasting.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0044ff' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logos/favicon-32x32.png?v=3" type="image/png" sizes="32x32" />
        <link rel="icon" href="/logos/favicon-16x16.png?v=3" type="image/png" sizes="16x16" />
        <link rel="shortcut icon" href="/logos/favicon-32x32.png?v=3" />
        <link rel="apple-touch-icon" href="/logos/app-blue-180.png?v=2" sizes="180x180" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" />
      </head>
      <body>{children}<InstallApp /></body>
    </html>
  );
}