'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Tv,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fetchLatestNetflixLink } from '@/lib/api';
import { COMPANY_NAME, whatsappLink } from '@/lib/support';
import { PLANS, PLAN_DESCRIPTION, getPlan } from '@/lib/plans';

type FlowTab = 'tv_login' | 'household' | 'buy';
type PageStatus = 'idle' | 'loading' | 'tv_success' | 'household_success' | 'error';

interface CustomerQuota {
  currentCount: number;
  maxCount: number;
}

const MOBILE_KEY = 'dreamlabs_saved_mobile';

// The mobile number is remembered in a cookie (365 days). The earlier version of this
// page stored it in localStorage, so that value is picked up once and moved.
function getSavedMobile(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${MOBILE_KEY}=([^;]+)`));
  if (match) return decodeURIComponent(match[1]);
  try {
    return localStorage.getItem('dreamlabs_mobile') || '';
  } catch {
    return '';
  }
}

function setSavedMobile(mobile: string) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${MOBILE_KEY}=${encodeURIComponent(mobile)}; expires=${expires}; path=/; SameSite=Lax`;
}

function clearSavedMobile() {
  if (typeof document === 'undefined') return;
  document.cookie = `${MOBILE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
  try {
    localStorage.removeItem('dreamlabs_mobile');
    localStorage.removeItem('dreamlabs_account');
  } catch {
    // ignore
  }
}

export default function NetflixHouseholdUpdater() {
  const [activeTab, setActiveTab] = useState<FlowTab>('household');
  const [mobileNumber, setMobileNumber] = useState('');
  const [tvCode, setTvCode] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [status, setStatus] = useState<PageStatus>('idle');
  const [loadingText, setLoadingText] = useState('');
  const [isClient, setIsClient] = useState(false);

  const [netflixLink, setNetflixLink] = useState<string | null>(null);
  const [quota, setQuota] = useState<CustomerQuota | null>(null);

  const [errorMessage, setErrorMessage] = useState('');
  const [errorReason, setErrorReason] = useState('');
  const [whatsAppUrl, setWhatsAppUrl] = useState('');

  // Buy plan
  const [planId, setPlanId] = useState(PLANS[0].id);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');

  useEffect(() => {
    setIsClient(true);
    const saved = getSavedMobile();
    if (/^\d{10}$/.test(saved)) {
      setMobileNumber(saved);
      setIsSaved(true);
      setSavedMobile(saved);
    }
  }, []);

  const handleMobileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 10);
    setMobileNumber(value);
    if (value.length === 10) {
      setSavedMobile(value);
      setIsSaved(true);
    }
  };

  const handleClearSaved = () => {
    clearSavedMobile();
    setMobileNumber('');
    setIsSaved(false);
    setStatus('idle');
  };

  const handleTvCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTvCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
  };

  const handleReset = () => {
    setStatus('idle');
    setTvCode('');
    setNetflixLink(null);
    setErrorMessage('');
    setErrorReason('');
    setWhatsAppUrl('');
  };

  const showError = (message: string, url?: string, reason?: string) => {
    setErrorMessage(message);
    setErrorReason(reason || '');
    setWhatsAppUrl(url || whatsappLink(mobileNumber, message));
    setStatus('error');
  };

  // No plan, or an expired one: the customer can buy right here.
  const canBuyFromError = errorReason === 'not_found' || errorReason === 'expired';

  const openBuyTab = () => {
    handleReset();
    setActiveTab('buy');
  };

  // 1. TV login: the server confirms the code on Netflix as the customer's own account
  const handleTvLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileNumber.length !== 10 || tvCode.length < 4) return;

    setSavedMobile(mobileNumber);
    setIsSaved(true);
    setStatus('loading');
    setLoadingText('Confirming your TV code with Netflix... this can take up to 20 seconds');
    setErrorMessage('');

    try {
      const res = await fetch('/api/activate-tv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: mobileNumber, code: tvCode }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showError(data.message || 'Failed to activate TV login', data.whatsappUrl, data.reason);
        return;
      }

      setQuota({ currentCount: data.currentCount || 1, maxCount: data.maxCount || 2 });
      setStatus('tv_success');
    } catch (err: any) {
      showError(err.message || 'Network error while activating TV');
    }
  };

  // 2. Household update: unlimited, no code needed
  const handleHouseholdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileNumber.length !== 10) return;

    setSavedMobile(mobileNumber);
    setIsSaved(true);
    setStatus('loading');
    setLoadingText('Fetching latest update link...');
    setErrorMessage('');

    // The server checks the subscription, finds the customer's own Netflix inbox and logs the update.
    const response = await fetchLatestNetflixLink(mobileNumber, 30);
    if (response.success && response.link) {
      setNetflixLink(response.link);
      setStatus('household_success');
    } else {
      showError(response.message || 'Failed to fetch Netflix update link', response.whatsappUrl, response.reason);
    }
  };

  // 3. Buy a plan: the server creates the order and returns a PayPur payment link.
  const selectedPlan = getPlan(planId) ?? PLANS[0];

  const handleBuySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileNumber.length !== 10 || buyerName.trim().length < 2 || !buyerEmail.includes('@')) return;

    setSavedMobile(mobileNumber);
    setIsSaved(true);
    setStatus('loading');
    setLoadingText('Starting your secure payment...');
    setErrorMessage('');

    try {
      const res = await fetch('/api/paypur/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, name: buyerName, email: buyerEmail, mobile: mobileNumber }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.payUrl) {
        showError(data?.message || 'Could not start the payment. Please try again.', data?.whatsappUrl);
        return;
      }
      window.location.href = data.payUrl;
    } catch (err: any) {
      showError(err.message || 'Network error while starting the payment');
    }
  };

  if (!isClient) return null;

  const savedBadge = isSaved && (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-green-400 flex items-center gap-1 font-medium">
        <CheckCircle2 className="w-3 h-3" /> Saved on device
      </span>
      <button
        type="button"
        onClick={handleClearSaved}
        className="text-[11px] text-netflix-red hover:underline cursor-pointer font-medium"
      >
        Not you? Clear
      </button>
    </div>
  );

  const mobileInput = (id: string) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-netflix-muted font-mono text-sm">+91</span>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder="Enter 10-digit mobile number"
        value={mobileNumber}
        onChange={handleMobileChange}
        className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted focus:ring-netflix-red focus:border-netflix-red h-12 text-base pl-12 font-mono"
        maxLength={10}
        required
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-netflix-dark flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Ambient gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-netflix-dark via-netflix-darker to-black opacity-80 pointer-events-none" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-netflix-red opacity-5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-netflix-red opacity-5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6 animate-fade-in">
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">{COMPANY_NAME}</h1>
          <h2 className="text-2xl md:text-3xl font-semibold text-netflix-red mt-1 mb-2">Netflix Household Updater</h2>
          <p className="text-netflix-gray text-sm md:text-base">Verify your access and update your devices</p>
        </div>

        <Card className="bg-netflix-card border-netflix-border backdrop-blur-sm shadow-2xl p-6 md:p-8 rounded-xl">
          {/* TAB SWITCHER */}
          <div className="grid grid-cols-3 p-1 bg-netflix-dark/80 rounded-xl border border-netflix-border mb-6 gap-1">
            {(
              [
                ['household', 'Household', <ExternalLink key="h" className="w-4 h-4 shrink-0" />],
                ['tv_login', 'TV Login', <Tv key="t" className="w-4 h-4 shrink-0" />],
                ['buy', 'Buy Plan', <ShoppingCart key="b" className="w-4 h-4 shrink-0" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  handleReset();
                }}
                className={`py-2.5 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeTab === id
                    ? 'bg-netflix-red text-white shadow-md shadow-netflix-red/30'
                    : 'text-netflix-gray hover:text-white'
                }`}
              >
                {icon} <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          {/* LOADING STATE */}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4 animate-fade-in">
              <Loader2 className="w-12 h-12 text-netflix-red animate-spin" />
              <p className="text-netflix-light text-base font-medium text-center">{loadingText}</p>
              <p className="text-netflix-muted text-xs text-center">Please wait a few seconds...</p>
            </div>
          )}

          {/* ERROR SCREEN WITH WHATSAPP BUTTON */}
          {status === 'error' && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center space-y-3">
                <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto" />
                <h3 className="text-xl font-bold text-white">Action Could Not Be Completed</h3>
                <p className="text-netflix-gray text-sm leading-relaxed">{errorMessage}</p>
              </div>

              {canBuyFromError && (
                <div className="bg-netflix-red/10 border border-netflix-red/40 rounded-xl p-4 space-y-3 text-center">
                  <p className="text-white text-sm font-semibold">You can buy a subscription directly</p>
                  <p className="text-netflix-gray text-xs">
                    Pay by UPI in a minute, then send your order details on WhatsApp and we activate your Netflix.
                  </p>
                  <Button
                    onClick={openBuyTab}
                    className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-11 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Buy Subscription
                  </Button>
                </div>
              )}

              <a
                href={whatsAppUrl || whatsappLink(mobileNumber, errorMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold h-13 text-sm rounded-lg transition-all duration-200 shadow-lg flex items-center justify-center gap-2.5 cursor-pointer py-3.5"
              >
                <MessageCircle className="w-5 h-5 fill-white" />
                Contact on WhatsApp
              </a>

              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full border-netflix-border text-netflix-light hover:text-white hover:bg-netflix-input/50 h-11 bg-transparent cursor-pointer flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </Button>
            </div>
          )}

          {/* TV LOGIN SUCCESS SCREEN */}
          {status === 'tv_success' && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center space-y-3">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
                <h3 className="text-2xl font-bold text-white">TV Signed In!</h3>
                <p className="text-netflix-gray text-sm">
                  Netflix confirmed your code. Your TV is now signed in to your Netflix account.
                </p>
                {quota && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-netflix-dark/80 border border-netflix-border text-xs text-netflix-light">
                    <Clock className="w-3.5 h-3.5 text-netflix-red" />
                    <span>
                      TV login {quota.currentCount} of {quota.maxCount} used this calendar month
                    </span>
                  </div>
                )}
              </div>

              <div className="bg-netflix-dark/60 border border-netflix-border rounded-xl p-4 text-xs space-y-2">
                <p className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="w-4 h-4 text-green-400" /> What happens now:
                </p>
                <ol className="text-netflix-muted space-y-1.5 list-decimal list-inside leading-relaxed text-[11px]">
                  <li>Your TV screen should change within a few seconds.</li>
                  <li>Choose your profile on the TV and start watching.</li>
                  <li>
                    If the TV still shows the code after 30 seconds, tap &ldquo;Contact on WhatsApp&rdquo; and send us your
                    number.
                  </li>
                </ol>
              </div>

              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full border-netflix-border text-white hover:bg-netflix-input/50 h-11 bg-transparent cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </div>
          )}

          {/* HOUSEHOLD SUCCESS SCREEN */}
          {status === 'household_success' && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center space-y-3">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
                <h3 className="text-2xl font-bold text-white">Access Verified!</h3>
                <p className="text-netflix-gray text-sm">Click below to verify your device with Netflix</p>
              </div>

              <Button
                onClick={() => {
                  if (netflixLink) window.open(netflixLink, '_blank', 'noopener,noreferrer');
                }}
                className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-14 text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-netflix-red/50 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                Update My Device
                <ExternalLink className="w-5 h-5" />
              </Button>

              <Button
                onClick={handleReset}
                variant="ghost"
                className="w-full text-netflix-gray hover:text-white hover:bg-netflix-input/50 h-11 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Check Another Number
              </Button>
            </div>
          )}

          {/* HOUSEHOLD FORM */}
          {status === 'idle' && activeTab === 'household' && (
            <form onSubmit={handleHouseholdSubmit} className="space-y-6 animate-fade-in">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="household-mobile" className="font-medium text-netflix-light">
                    Mobile Number
                  </label>
                  {savedBadge}
                </div>
                {mobileInput('household-mobile')}
                <p className="text-xs text-netflix-muted">
                  {mobileNumber.length}/10 digits &mdash; household update has no monthly limit.
                </p>
              </div>

              <Button
                type="submit"
                disabled={mobileNumber.length !== 10}
                className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-12 text-base rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-netflix-red/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <ExternalLink className="w-5 h-5" />
                Check Permission
              </Button>

              <div className="bg-netflix-dark/60 border border-netflix-border/80 rounded-xl p-4 text-xs space-y-2">
                <p className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <ExternalLink className="w-4 h-4 text-netflix-red" /> How household update works:
                </p>
                <ol className="text-netflix-muted space-y-1.5 list-decimal list-inside leading-relaxed text-[11px]">
                  <li>
                    On your TV or phone, choose <strong className="text-netflix-light">&ldquo;Update Primary Location&rdquo;</strong>{' '}
                    so Netflix sends the email.
                  </li>
                  <li>
                    Enter your number and tap <strong className="text-netflix-light">&ldquo;Check Permission&rdquo;</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-netflix-light">&ldquo;Update My Device&rdquo;</strong> and confirm on Netflix.
                  </li>
                </ol>
              </div>
            </form>
          )}

          {/* TV LOGIN FORM */}
          {status === 'idle' && activeTab === 'tv_login' && (
            <form onSubmit={handleTvLoginSubmit} className="space-y-5 animate-fade-in">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="mobile" className="font-medium text-netflix-light">
                    Mobile Number
                  </label>
                  {savedBadge}
                </div>
                {mobileInput('mobile')}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="tvcode" className="text-xs font-medium text-netflix-light uppercase tracking-wider block">
                  Netflix TV Code
                </label>
                <Input
                  id="tvcode"
                  type="text"
                  placeholder="e.g. 48291048"
                  value={tvCode}
                  onChange={handleTvCodeChange}
                  className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted focus:ring-netflix-red focus:border-netflix-red h-13 text-center font-mono text-xl tracking-widest uppercase"
                  maxLength={8}
                  required
                />
                <p className="text-[11px] text-netflix-muted text-center">Shown on your TV screen (e.g. at netflix.com/tv2)</p>
              </div>

              <Button
                type="submit"
                disabled={mobileNumber.length !== 10 || tvCode.length < 4}
                className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-12 text-base rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-netflix-red/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Tv className="w-5 h-5" />
                Activate TV Login
              </Button>

              <div className="flex items-center justify-between text-[11px] text-netflix-muted pt-1 px-1">
                <span>Monthly TV login limit applies</span>
                <span>Resets 1st of each month</span>
              </div>

              <div className="bg-netflix-dark/60 border border-netflix-border/80 rounded-xl p-4 text-xs space-y-2 mt-4">
                <p className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <Tv className="w-4 h-4 text-netflix-red" /> How to log in on your TV:
                </p>
                <ol className="text-netflix-muted space-y-1.5 list-decimal list-inside leading-relaxed text-[11px]">
                  <li>
                    <strong className="text-netflix-light">Open the Netflix app</strong> on your Smart TV.
                  </li>
                  <li>
                    Click <strong className="text-netflix-light">&ldquo;Sign In&rdquo;</strong> to view your TV activation code.
                  </li>
                  <li>Enter your registered mobile number and the TV code above.</li>
                  <li>
                    Click <strong className="text-netflix-light">&ldquo;Activate TV Login&rdquo;</strong> to pair your device.
                  </li>
                  <li>Your TV will sign in automatically &mdash; choose your profile and enjoy streaming!</li>
                </ol>
              </div>
            </form>
          )}

          {/* BUY FORM */}
          {status === 'idle' && activeTab === 'buy' && (
            <form onSubmit={handleBuySubmit} className="space-y-5 animate-fade-in">
              <div className="space-y-1.5">
                <label htmlFor="plan" className="text-xs font-medium text-netflix-light block">
                  Choose your plan
                </label>
                <select
                  id="plan"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="w-full h-12 rounded-md bg-netflix-input border border-netflix-border text-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-netflix-red cursor-pointer"
                >
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} &mdash; ₹{p.price}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between bg-netflix-dark/60 border border-netflix-border/80 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-white text-sm font-semibold">Netflix &bull; {selectedPlan.label}</p>
                    <p className="text-netflix-muted text-[11px]">{PLAN_DESCRIPTION}</p>
                  </div>
                  <p className="text-netflix-red text-2xl font-bold">₹{selectedPlan.price}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="buyer-name" className="text-xs font-medium text-netflix-light block">
                  Your Name
                </label>
                <Input
                  id="buyer-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Full name"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted focus:ring-netflix-red focus:border-netflix-red h-12 text-base"
                  maxLength={60}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="buy-mobile" className="font-medium text-netflix-light">
                    Mobile Number
                  </label>
                  {savedBadge}
                </div>
                {mobileInput('buy-mobile')}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="buyer-email" className="text-xs font-medium text-netflix-light block">
                  Email
                </label>
                <Input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value.trim())}
                  className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted focus:ring-netflix-red focus:border-netflix-red h-12 text-base"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={mobileNumber.length !== 10 || buyerName.trim().length < 2 || !buyerEmail.includes('@')}
                className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-12 text-base rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-netflix-red/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <ShoppingCart className="w-5 h-5" />
                Pay ₹{selectedPlan.price} with UPI
              </Button>

              <div className="bg-netflix-dark/60 border border-netflix-border/80 rounded-xl p-4 text-xs space-y-2">
                <p className="font-semibold text-white flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="w-4 h-4 text-green-400" /> How buying works:
                </p>
                <ol className="text-netflix-muted space-y-1.5 list-decimal list-inside leading-relaxed text-[11px]">
                  <li>Choose a plan and pay securely by UPI.</li>
                  <li>
                    After payment you are taken to <strong className="text-netflix-light">WhatsApp</strong> to send us your order
                    details.
                  </li>
                  <li>We set up your Netflix and you can use Update Household and TV Login here.</li>
                </ol>
              </div>
            </form>
          )}
        </Card>

        <div className="mt-6 text-center text-xs text-netflix-muted">For authorized users only &bull; {COMPANY_NAME}</div>
      </div>
    </div>
  );
}
