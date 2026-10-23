import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Tug of War: Crypto Prediction Arena',
  description: 'Interactive prototype for 20-player Long vs Short crypto battle royale with real-time queue lobby, match inspection, and dynamic payout estimation.',
  openGraph: {
    title: 'Tug of War: Crypto Prediction Arena',
    description: 'Interactive prototype for 20-player Long vs Short crypto battle royale with real-time queue lobby, match inspection, and dynamic payout estimation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tug of War: Crypto Prediction Arena',
    description: 'Interactive prototype for 20-player Long vs Short crypto battle royale with real-time queue lobby, match inspection, and dynamic payout estimation.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
