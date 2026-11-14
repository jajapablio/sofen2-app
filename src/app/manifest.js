export default function manifest() {
    return {
        id: '/', name: 'PredictPOS', short_name: 'PredictPOS',
        description: 'Point of sale, inventory management, and sales forecasts.',
        start_url: '/', scope: '/', display: 'standalone',
        background_color: '#f5f7fb', theme_color: '#0044ff',
        icons: [
            { src: '/logos/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/logos/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
    };
}
