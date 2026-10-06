'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, MessageCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { COMPANY_NAME, whatsappLink } from '@/lib/support';

interface OrderView {
  orderId: string;
  status: 'created' | 'pending' | 'paid' | 'failed';
  planLabel: string;
  amount: number;
  txnId: string | null;
  mobile: string;
}

const REDIRECT_SECONDS = 8;

function Result() {
  const params = useSearchParams();
  const orderId = params.get('order') || '';
  const [order, setOrder] = useState<OrderView | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [loading, setLoading] = useState(Boolean(orderId));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(orderId ? '' : 'We could not find this order.');
  const [seconds, setSeconds] = useState(REDIRECT_SECONDS);
  const [autoRedirect, setAutoRedirect] = useState(true);
  const autoChecked = useRef(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!orderId) return;
      try {
        const res = await fetch(`/api/paypur/order?id=${encodeURIComponent(orderId)}${refresh ? '&refresh=1' : ''}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          setError(data?.message || 'We could not load this order.');
          return;
        }
        setError('');
        setOrder(data.order);
        setWhatsappUrl(data.whatsappUrl);
      } catch {
        setError('Could not reach the server. Please check your internet connection.');
      }
    },
    [orderId]
  );

  useEffect(() => {
    if (!orderId) return;
    load(false).finally(() => setLoading(false));
  }, [orderId, load]);

  // If PayPur has not told us the result yet, ask it once on our own.
  useEffect(() => {
    if (!order || order.status === 'paid' || order.status === 'failed' || autoChecked.current) return;
    autoChecked.current = true;
    const t = setTimeout(() => load(true), 2500);
    return () => clearTimeout(t);
  }, [order, load]);

  // Paid: send the customer to WhatsApp with their order details.
  useEffect(() => {
    if (order?.status !== 'paid' || !autoRedirect || !whatsappUrl) return;
    if (seconds <= 0) {
      window.location.href = whatsappUrl;
      return;
    }
    const t = setTimeout(() => setSeconds((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [order, autoRedirect, whatsappUrl, seconds]);

  const checkAgain = async () => {
    setChecking(true);
    await load(true);
    setChecking(false);
  };

  const help = whatsappUrl || whatsappLink(order?.mobile || '', `Question about order ${orderId || ''}`);

  return (
    <div className="min-h-screen bg-netflix-dark flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute inset-0 bg-gradient-to-br from-netflix-dark via-netflix-darker to-black opacity-80 pointer-events-none" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-netflix-red opacity-5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white leading-tight">{COMPANY_NAME}</h1>
          <h2 className="text-xl font-semibold text-netflix-red mt-1">Your Order</h2>
        </div>

        <Card className="bg-netflix-card border-netflix-border shadow-2xl p-6 md:p-8 rounded-xl">
          {loading && (
            <div className="flex flex-col items-center py-10 space-y-4">
              <Loader2 className="w-12 h-12 text-netflix-red animate-spin" />
              <p className="text-netflix-light text-sm">Checking your payment...</p>
            </div>
          )}

          {!loading && error && !order && (
            <div className="space-y-6 text-center">
              <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto" />
              <p className="text-netflix-gray text-sm">{error}</p>
              <a
                href={whatsappLink('', error)}
                className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold text-sm rounded-lg flex items-center justify-center gap-2.5 py-3.5"
              >
                <MessageCircle className="w-5 h-5 fill-white" /> Contact on WhatsApp
              </a>
            </div>
          )}

          {!loading && order && (
            <div className="space-y-6">
              {order.status === 'paid' ? (
                <div className="text-center space-y-3">
                  <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
                  <h3 className="text-2xl font-bold text-white">Payment received!</h3>
                  <p className="text-netflix-gray text-sm">
                    One last step: send your order details on WhatsApp so we can activate your Netflix.
                  </p>
                </div>
              ) : order.status === 'failed' ? (
                <div className="text-center space-y-3">
                  <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto" />
                  <h3 className="text-xl font-bold text-white">Payment was not completed</h3>
                  <p className="text-netflix-gray text-sm">
                    No money was taken for this order. If you were charged, send us the order details on WhatsApp.
                  </p>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <Clock className="w-16 h-16 text-yellow-500 mx-auto" />
                  <h3 className="text-xl font-bold text-white">Waiting for payment confirmation</h3>
                  <p className="text-netflix-gray text-sm">
                    We have not received the result from your bank yet. If you already paid, tap &ldquo;Check again&rdquo; in a few
                    seconds, or send us the order details on WhatsApp.
                  </p>
                </div>
              )}

              <div className="bg-netflix-dark/60 border border-netflix-border rounded-xl p-4 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-netflix-muted">Plan</span>
                  <span className="text-white font-medium">{order.planLabel} &bull; 4K UHD &bull; 1 Device</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-netflix-muted">Amount</span>
                  <span className="text-white font-medium">₹{order.amount}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-netflix-muted">Order ID</span>
                  <span className="text-white font-mono break-all text-right">{order.orderId}</span>
                </div>
                {order.txnId && (
                  <div className="flex justify-between gap-3">
                    <span className="text-netflix-muted">Transaction ID</span>
                    <span className="text-white font-mono break-all text-right">{order.txnId}</span>
                  </div>
                )}
              </div>

              <a
                href={help}
                className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold text-sm rounded-lg transition-all duration-200 shadow-lg flex items-center justify-center gap-2.5 py-3.5"
              >
                <MessageCircle className="w-5 h-5 fill-white" />
                {order.status === 'paid' ? 'Send order details on WhatsApp' : 'Contact on WhatsApp'}
              </a>

              {order.status === 'paid' && autoRedirect && (
                <p className="text-center text-[11px] text-netflix-muted">
                  Opening WhatsApp in {seconds}s &middot;{' '}
                  <button type="button" onClick={() => setAutoRedirect(false)} className="text-netflix-red hover:underline cursor-pointer">
                    stay on this page
                  </button>
                </p>
              )}

              {order.status !== 'paid' && (
                <Button
                  onClick={checkAgain}
                  disabled={checking}
                  variant="outline"
                  className="w-full border-netflix-border text-netflix-light hover:text-white hover:bg-netflix-input/50 h-11 bg-transparent cursor-pointer flex items-center justify-center gap-2"
                >
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Check again
                </Button>
              )}

              <Link
                href="/"
                className="flex items-center justify-center gap-2 text-netflix-gray hover:text-white text-sm py-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Home
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function BuyResultPage() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
