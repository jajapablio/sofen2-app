import './globals.css';
import InstallApp from '../components/InstallApp';

export const metadata = {
  title: 'PredictPOS',
  applicationName: 'PredictPOS',
  appleWebApp: { capable: true, title: 'PredictPOS', statusBarStyle: 'default' },
  icons: { apple: '/logos/app-blue-180.png', icon: [{ url: '/logos/favicon-blue-32.png', sizes: '32x32', type: 'image/png' }, { url: '/logos/favicon-blue-16.png', sizes: '16x16', type: 'image/png' }], shortcut: '/logos/favicon-blue-32.png' },
  description: 'An automated point-of-sale and inventory control system using predictive analysis for sales forecasting.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0044ff' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" />
      </head>
      <body>{children}<InstallApp /></body>
    </html>
  );
}