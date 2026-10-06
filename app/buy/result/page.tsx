import { getBrand } from '@/lib/branding';
import BuyResultClient from './result-client';

export const dynamic = 'force-dynamic';

export default async function BuyResultPage() {
  return <BuyResultClient brand={await getBrand()} />;
}
