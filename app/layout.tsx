import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Tug of War: Crypto Prediction Arena',
  description: 'Interactive prototype for Long vs Short crypto match game on dreamDEX perps: join a match with a real market order and see the result computed from chain data.',
  openGraph: {
    title: 'Tug of War: Crypto Prediction Arena',
    description: 'Interactive prototype for Long vs Short crypto match game on dreamDEX perps: join a match with a real market order and see the result computed from chain data.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tug of War: Crypto Prediction Arena',
    description: 'Interactive prototype for Long vs Short crypto match game on dreamDEX perps: join a match with a real market order and see the result computed from chain data.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
