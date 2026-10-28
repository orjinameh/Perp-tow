'use client';

import { useEffect } from 'react';

// The game lives on the main page, with the navbar and wallet.
export default function SquadsRedirect() {
  useEffect(() => { window.location.replace('/'); }, []);
  return null;
}
