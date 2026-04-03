'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, ArrowLeft, Loader } from 'lucide-react';
import { fetchLatestNetflixLink } from '@/lib/api';

type Status = 'idle' | 'verifying' | 'fetching' | 'success' | 'error';

export default function Home() {
  const [mobileNumber, setMobileNumber] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [netflixLink, setNetflixLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [mounted, setMounted] = useState(false);

  // On mount - load saved preferences from localStorage
  useEffect(() => {
    setMounted(true);
    const savedMobile = localStorage.getItem('dreamlabs_mobile');
    const savedAccount = localStorage.getItem('dreamlabs_account');

    if (savedMobile) setMobileNumber(savedMobile);
    if (savedAccount) {
      const num = parseInt(savedAccount);
      if (num >= 1 && num <= 5) setSelectedAccount(num);
    }
  }, []);

  const handleCheckPermission = async () => {
    if (mobileNumber.length !== 10 || selectedAccount === null) return;

    // Save preferences to localStorage
    localStorage.setItem('dreamlabs_mobile', mobileNumber);
    localStorage.setItem('dreamlabs_account', String(selectedAccount));

    setStatus('verifying');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    setStatus('fetching');
    try {
      const res = await fetchLatestNetflixLink(selectedAccount, 30);
      if (res.success && res.link) {
        setNetflixLink(res.link);
        setStatus('success');
      } else {
        setErrorMessage(res.message || 'An error occurred');
        setStatus('error');
      }
    } catch (error) {
      setErrorMessage(
        'Service is temporarily unavailable. Please try again shortly.'
      );
      setStatus('error');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setNetflixLink(null);
    setErrorMessage('');
  };

  if (!mounted) return null;

  return (
    <div className="bg-[#141414] min-h-screen flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="text-center mb-32">
        <h1 className="text-3xl font-bold text-white">Dream Labs Solutions</h1>
        <h2 className="text-2xl font-semibold text-[#E50914] mt-2">
          Netflix Household Updater
        </h2>
        <p className="text-sm text-[#999999] mt-2">
          Verify your access and update your device
        </p>
      </div>

      {/* Main Card */}
      <div className="max-w-[800px] w-full bg-[#1f1f1f] border border-[#333333] rounded-xl p-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Panel - Account Selection */}
          <div className="w-full md:w-[35%]">
            <div className="text-sm font-medium text-[#999999] mb-3">
              Select Account
            </div>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((accountNum) => (
                <button
                  key={accountNum}
                  onClick={() => setSelectedAccount(accountNum)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 ${
                    selectedAccount === accountNum
                      ? 'bg-[#2a1a1a] border-t border-r border-b border-[#E50914]/50 border-l-4 border-l-[#E50914] text-white font-bold shadow-[0_0_12px_rgba(229,9,20,0.3)] cursor-pointer'
                      : 'bg-[#141414] border border-[#333333] text-[#999999] hover:border-[#E50914]/50 hover:bg-[#1a1a1a] cursor-pointer'
                  }`}
                >
                  Account {accountNum}
                </button>
              ))}
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-[#333333] self-stretch hidden md:block" />

          {/* Right Panel - Dynamic Content */}
          <div className="flex-1">
            {status === 'idle' && (
              <>
                <label className="text-sm text-[#999999] mb-1 block">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setMobileNumber(digits.slice(0, 10));
                  }}
                  className="w-full bg-[#141414] border border-[#333333] text-white rounded-lg px-4 py-3 focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914]"
                  placeholder="Enter 10-digit mobile number"
                />
                <p className="text-xs text-[#999999] mt-1">
                  {mobileNumber.length}/10 digits
                </p>
                <button
                  onClick={handleCheckPermission}
                  disabled={mobileNumber.length !== 10 || selectedAccount === null}
                  className="w-full mt-4 bg-[#E50914] hover:bg-[#C40812] text-white font-semibold py-3 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Check Permission
                </button>
              </>
            )}

            {status === 'verifying' && (
              <div className="flex flex-col items-center justify-center h-40">
                <Loader className="w-10 h-10 text-[#E50914] animate-spin" />
                <p className="text-white mt-4">Verifying your access...</p>
              </div>
            )}

            {status === 'fetching' && (
              <div className="flex flex-col items-center justify-center h-40">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <p className="text-green-500 font-semibold mt-2">
                  ✓ Access Verified!
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Loader className="w-5 h-5 text-white animate-spin" />
                  <p className="text-white">Fetching latest update link...</p>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center justify-center h-auto">
                <CheckCircle2 className="w-16 h-16 text-green-500" />
                <p className="text-2xl font-bold text-white mt-3">
                  Access Verified!
                </p>
                <p className="text-sm text-[#999999] mt-1">
                  Click below to verify your device with Netflix
                </p>
                <button
                  onClick={() => window.open(netflixLink, '_blank')}
                  className="w-full mt-6 bg-[#E50914] hover:bg-[#C40812] text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-all duration-200"
                >
                  Update My Device
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  onClick={handleReset}
                  className="w-full mt-2 text-[#999999] hover:text-white py-2 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-2" />
                  Check Another Number
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center justify-center h-auto">
                <AlertTriangle className="w-16 h-16 text-yellow-500" />
                <p className="text-xl font-bold text-white mt-3">
                  ⚠ Error Fetching Link
                </p>
                <p className="text-sm text-[#999999] mt-2 text-center max-w-xs">
                  {errorMessage}
                </p>
                <div className="flex gap-3 mt-6 w-full">
                  <button
                    onClick={handleCheckPermission}
                    className="flex-1 bg-[#E50914] hover:bg-[#C40812] text-white font-semibold py-2 rounded-lg transition-all duration-200"
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex-1 border border-[#333333] text-white hover:bg-[#333333] font-semibold py-2 rounded-lg transition-all duration-200"
                  >
                    <ArrowLeft className="w-4 h-4 inline mr-2" />
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-xs text-[#999999]">
        For authorized users only • Dream Labs Solutions
      </div>
    </div>
  );
}
