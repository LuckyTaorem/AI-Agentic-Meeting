'use client';

import dynamic from 'next/dynamic';

// Force Next.js to skip Server-Side Rendering for this component entirely
const GothamSession = dynamic(() => import('./GothamSession'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center">
      <div className="text-amber-500 font-medium tracking-widest animate-pulse uppercase text-sm">
        Loading Secure Environment...
      </div>
    </div>
  )
});

export default function Page() {
  return <GothamSession />;
}