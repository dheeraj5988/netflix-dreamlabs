'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { fetchNetflixCode } from '@/lib/api';

export default function Home() {
  const [accountNumber, setAccountNumber] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [codeUrl, setCodeUrl] = useState('');
  const [storedCodes, setStoredCodes] = useState<
    { account: number; code: string; timestamp: string }[]
  >([]);

  // Load stored codes from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('netflixCodes');
    if (stored) {
      try {
        setStoredCodes(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored codes');
      }
    }
  }, []);

  const handleFetchCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setCode('');
    setCodeUrl('');

    // Validate inputs
    if (!accountNumber) {
      setError('Please select an account number');
      return;
    }

    const accountNum = parseInt(accountNumber, 10);
    if (isNaN(accountNum) || accountNum < 1 || accountNum > 5) {
      setError('Account number must be between 1 and 5');
      return;
    }

    if (!mobileNumber) {
      setError('Please enter a mobile number');
      return;
    }

    if (mobileNumber.replace(/\D/g, '').length !== 10) {
      setError('Mobile number must contain 10 digits');
      return;
    }

    setLoading(true);

    try {
      const result = await fetchNetflixCode(accountNum);

      if (result.error) {
        setError(result.error);
      } else if (result.code) {
        setCode(result.code);
        setCodeUrl(result.url || '');
        setSuccess(true);

        // Store the code
        const newCodes = [
          ...storedCodes,
          {
            account: accountNum,
            code: result.code,
            timestamp: new Date().toLocaleString(),
          },
        ].slice(-10); // Keep last 10 codes

        setStoredCodes(newCodes);
        localStorage.setItem('netflixCodes', JSON.stringify(newCodes));
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setStoredCodes([]);
    localStorage.removeItem('netflixCodes');
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-black to-[#1a1a1a] text-white p-4">
      <div className="max-w-2xl mx-auto py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Netflix Household</h1>
          <p className="text-xl text-gray-400">
            Get your verification code instantly
          </p>
        </div>

        {/* Main Form Card */}
        <Card className="bg-[#222] border-[#333] mb-8 p-8">
          <form onSubmit={handleFetchCode} className="space-y-6">
            {/* Error Alert */}
            {error && (
              <Alert className="bg-red-900/20 border-red-800 text-red-300">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Success Alert */}
            {success && code && (
              <Alert className="bg-green-900/20 border-green-800 text-green-300">
                <AlertDescription>
                  Verification code found! Check below for your code.
                </AlertDescription>
              </Alert>
            )}

            {/* Account Number Selection */}
            <div className="space-y-2">
              <label htmlFor="account" className="block text-sm font-medium">
                Account Number
              </label>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setAccountNumber(String(num))}
                    className={`py-3 px-4 rounded-lg font-semibold transition-all ${
                      accountNumber === String(num)
                        ? 'bg-[#E50914] text-white'
                        : 'bg-[#333] text-gray-300 hover:bg-[#444]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Number Input */}
            <div className="space-y-2">
              <label htmlFor="mobile" className="block text-sm font-medium">
                Mobile Number (10 digits)
              </label>
              <Input
                id="mobile"
                type="tel"
                placeholder="Enter 10-digit mobile number"
                value={mobileNumber}
                onChange={(e) =>
                  setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                className="bg-[#333] border-[#444] text-white placeholder:text-gray-500"
              />
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E50914] hover:bg-[#C40812] text-white font-bold py-3 rounded-lg"
            >
              {loading ? 'Fetching Code...' : 'Get Verification Code'}
            </Button>
          </form>
        </Card>

        {/* Code Display Section */}
        {success && code && (
          <Card className="bg-[#222] border-[#333] mb-8 p-8">
            <h2 className="text-2xl font-bold mb-4">Your Verification Code</h2>
            <div className="space-y-4">
              <div className="bg-[#111] border-2 border-[#E50914] rounded-lg p-6 text-center">
                <p className="text-gray-400 text-sm mb-2">Code</p>
                <p className="text-4xl font-mono font-bold text-[#E50914] break-all">
                  {code}
                </p>
              </div>

              {codeUrl && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">Or use the direct link:</p>
                  <a
                    href={codeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full bg-[#333] hover:bg-[#444] text-white p-3 rounded-lg text-center text-sm break-all"
                  >
                    Open Netflix Link
                  </a>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* History Section */}
        {storedCodes.length > 0 && (
          <Card className="bg-[#222] border-[#333] p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Recent Codes</h2>
              <Button
                onClick={clearHistory}
                variant="outline"
                className="border-[#444] text-gray-300 hover:bg-[#333]"
              >
                Clear History
              </Button>
            </div>

            <div className="space-y-3">
              {storedCodes
                .slice()
                .reverse()
                .map((entry, index) => (
                  <div
                    key={index}
                    className="bg-[#111] border border-[#333] rounded-lg p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-mono font-semibold text-[#E50914]">
                        {entry.code}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Account {entry.account} • {entry.timestamp}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(entry.code);
                      }}
                      className="text-gray-400 hover:text-white text-sm"
                    >
                      Copy
                    </button>
                  </div>
                ))}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
