import { getPublicConfig } from '@/lib/branding';
import Home from './home-client';

// The company name, support number and plans come from Admin > Settings, so this page is rendered per request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const { brand, plans } = await getPublicConfig();
  return <Home brand={brand} plans={plans} />;
}
