import { useState, useEffect } from 'react';
import { Wallet, ArrowDownCircle, ArrowUpCircle, History, X, QrCode, Copy, Check } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface PixWalletProps {
  userId?: string;
  onClose?: () => void;
}

interface PixTransaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  status: string;
  pixKey?: string | null;
  balanceAfter?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function PixWallet({ userId, onClose }: PixWalletProps) {
  const { showNotification } = useNotification();
  const [balance, setBalance] = useState<number>(0);
  const [pixKey, setPixKey] = useState<string>('');
  const [hasPixKey, setHasPixKey] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'history' | 'settings'>('deposit');
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawPixKey, setWithdrawPixKey] = useState<string>('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<PixTransaction[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [pixEnabled, setPixEnabled] = useState<boolean>(false);
  // Payer information for deposits
  const [payerEmail, setPayerEmail] = useState<string>('');
  const [payerFirstName, setPayerFirstName] = useState<string>('');
  const [payerLastName, setPayerLastName] = useState<string>('');
  const [payerIdentificationType, setPayerIdentificationType] = useState<string>('CPF');
  const [payerIdentificationNumber, setPayerIdentificationNumber] = useState<string>('');

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (userId) {
      checkPixStatus();
      fetchBalance();
      fetchPixKey();
      fetchTransactions();
    }
  }, [userId]);

  const checkPixStatus = async () => {
    // Pix is enabled if Mercado Pago token is configured
    // The actual status will be determined when making a deposit request
    // For now, assume it's enabled - the API will return 503 if not configured
    setPixEnabled(true);
  };

  const fetchBalance = async () => {
    if (!userId) return;
    try {
      // Get balance from betting info endpoint or create a dedicated endpoint
      const socket = (window as any).socket;
      if (socket) {
        socket.emit('get_betting_info');
        socket.once('betting_info', (data: { userBalance: number }) => {
          setBalance(data.userBalance || 0);
        });
      }
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  };

  const fetchPixKey = async () => {
    if (!userId) return;
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/pix/pix-key/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setHasPixKey(data.hasPixKey);
        if (data.pixKey) {
          setPixKey(data.pixKey);
        }
      }
    } catch (error) {
      console.error('Error fetching Pix key:', error);
    }
  };

  const fetchTransactions = async () => {
    if (!userId) return;
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/pix/transactions`);
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const handleDeposit = async () => {
    if (!userId) return;
    const amount = parseFloat(depositAmount);
    if (!amount || amount < 1) {
      showNotification('Minimum deposit is R$ 1.00', 'error');
      return;
    }

    // Validate payer information
    if (!payerEmail || !payerFirstName || !payerLastName) {
      showNotification('Please fill in all payer information (email, first name, last name)', 'error');
      return;
    }

    if (!payerIdentificationNumber) {
      showNotification('Please enter your identification number (CPF or CNPJ)', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/pix/deposit/request`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          payer: {
            email: payerEmail,
            firstName: payerFirstName,
            lastName: payerLastName,
            identification: {
              type: payerIdentificationType,
              number: payerIdentificationNumber.replace(/\D/g, ''), // Remove non-digits
            },
          },
        }),
      });

      const data = await response.json();

      if (response.status === 503) {
        showNotification('Pix integration is not configured', 'info');
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        showNotification(data.error || 'Failed to create deposit request', 'error');
        setIsLoading(false);
        return;
      }

      setQrCode(data.qrCode);
      setQrCodeBase64(data.qrCodeBase64);
      setQrExpiresAt(data.expiresAt);
      setTransactionId(data.transactionId);
      showNotification('QR Code generated. Scan to complete payment.', 'success');
      
      // Poll for status
      pollDepositStatus(data.transactionId);
    } catch (error) {
      showNotification('Error creating deposit request', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollDepositStatus = async (txId: string) => {
    if (!userId) return;
    const interval = setInterval(async () => {
      try {
        const { authenticatedFetch } = await import('../utils/api');
        const response = await authenticatedFetch(
          `${API_BASE}/api/pix/deposit/status/${txId}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'completed') {
            clearInterval(interval);
            showNotification('Deposit completed successfully!', 'success');
            setQrCode(null);
            setQrCodeBase64(null);
            setTransactionId(null);
            setDepositAmount('');
            setPayerEmail('');
            setPayerFirstName('');
            setPayerLastName('');
            setPayerIdentificationNumber('');
            fetchBalance();
            fetchTransactions();
          } else if (data.status === 'failed') {
            clearInterval(interval);
            showNotification(data.errorMessage || 'Deposit failed', 'error');
            setQrCode(null);
            setQrCodeBase64(null);
            setTransactionId(null);
          }
        }
      } catch (error) {
        console.error('Error polling deposit status:', error);
      }
    }, 3000); // Poll every 3 seconds

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const handleWithdraw = async () => {
    if (!userId) return;
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < 1) {
      showNotification('Minimum withdrawal is R$ 1.00', 'error');
      return;
    }

    if (!withdrawPixKey || withdrawPixKey.length < 3) {
      showNotification('Please enter a valid Pix key', 'error');
      return;
    }

    if (amount > balance) {
      showNotification('Insufficient balance', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/pix/withdrawal/request`, {
        method: 'POST',
        body: JSON.stringify({ amount, pixKey: withdrawPixKey }),
      });

      const data = await response.json();

      if (response.status === 503) {
        showNotification('Pix integration is not available yet', 'info');
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        showNotification(data.error || 'Failed to create withdrawal request', 'error');
        setIsLoading(false);
        return;
      }

      showNotification('Withdrawal request submitted', 'success');
      setWithdrawAmount('');
      setWithdrawPixKey('');
      
      // Poll for status
      pollWithdrawalStatus(data.transactionId);
    } catch (error) {
      showNotification('Error creating withdrawal request', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollWithdrawalStatus = async (txId: string) => {
    if (!userId) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/pix/withdrawal/status/${txId}?userId=${userId}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'completed') {
            clearInterval(interval);
            showNotification('Withdrawal completed successfully!', 'success');
            fetchBalance();
            fetchTransactions();
          } else if (data.status === 'failed') {
            clearInterval(interval);
            showNotification(data.errorMessage || 'Withdrawal failed', 'error');
          }
        }
      } catch (error) {
        console.error('Error polling withdrawal status:', error);
      }
    }, 3000);

    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const handleSavePixKey = async () => {
    if (!userId) return;
    if (!pixKey || pixKey.length < 3) {
      showNotification('Please enter a valid Pix key', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(`${API_BASE}/api/pix/pix-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixKey }),
      });

      if (response.ok) {
        showNotification('Pix key saved successfully', 'success');
        setHasPixKey(true);
        if (activeTab === 'withdraw') {
          setWithdrawPixKey(pixKey);
        }
      } else {
        const data = await response.json();
        showNotification(data.error || 'Failed to save Pix key', 'error');
      }
    } catch (error) {
      showNotification('Error saving Pix key', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    showNotification('Copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50';
      case 'pending':
      case 'processing':
        return 'text-yellow-600 bg-yellow-50';
      case 'failed':
      case 'cancelled':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  if (!pixEnabled) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-2xl mx-auto">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        )}
        <div className="text-center py-8">
          <Wallet className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Pix Integration</h2>
          <p className="text-gray-600 mb-4">
            Pix integration is coming soon!
          </p>
          <p className="text-sm text-gray-500">
            This feature will allow you to deposit and withdraw funds using Pix.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-4xl mx-auto relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Wallet className="w-8 h-8 text-blue-600" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Pix Wallet</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-600">Balance:</span>
            <span className="text-xl font-bold text-green-600">
              R$ {balance.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('deposit')}
          className={`px-4 py-2 font-semibold transition-colors ${
            activeTab === 'deposit'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <ArrowDownCircle className="w-4 h-4 inline mr-2" />
          Deposit
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={`px-4 py-2 font-semibold transition-colors ${
            activeTab === 'withdraw'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <ArrowUpCircle className="w-4 h-4 inline mr-2" />
          Withdraw
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-semibold transition-colors ${
            activeTab === 'history'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <History className="w-4 h-4 inline mr-2" />
          History
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 font-semibold transition-colors ${
            activeTab === 'settings'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Settings
        </button>
      </div>

      {/* Deposit Tab */}
      {activeTab === 'deposit' && (
        <div className="space-y-4">
          {qrCode ? (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Scan QR Code to Complete Payment
              </h3>
              {qrCodeBase64 && (
                <div className="mb-4">
                  <img
                    src={qrCodeBase64}
                    alt="Pix QR Code"
                    className="mx-auto w-64 h-64 border-2 border-gray-300 rounded-lg"
                  />
                </div>
              )}
              <div className="bg-white p-4 rounded-lg mb-4">
                <p className="text-xs text-gray-600 mb-2">Pix Copy & Paste Code:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs break-all p-2 bg-gray-100 rounded">
                    {qrCode}
                  </code>
                  <button
                    onClick={() => copyToClipboard(qrCode)}
                    className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {qrExpiresAt && (
                <p className="text-sm text-gray-600">
                  Expires at: {new Date(qrExpiresAt).toLocaleString()}
                </p>
              )}
              <button
                onClick={() => {
                  setQrCode(null);
                  setQrCodeBase64(null);
                  setTransactionId(null);
                }}
                className="mt-4 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Deposit Amount (BRL)
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-lg"
                />
                <p className="text-xs text-gray-500 mt-1">Minimum: R$ 1.00</p>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Payer Information</h3>
                
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={payerFirstName}
                      onChange={(e) => setPayerFirstName(e.target.value)}
                      placeholder="John"
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={payerLastName}
                      onChange={(e) => setPayerLastName(e.target.value)}
                      placeholder="Doe"
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={payerEmail}
                    onChange={(e) => setPayerEmail(e.target.value)}
                    placeholder="john.doe@example.com"
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Identification Type *
                    </label>
                    <select
                      value={payerIdentificationType}
                      onChange={(e) => setPayerIdentificationType(e.target.value)}
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                    >
                      <option value="CPF">CPF</option>
                      <option value="CNPJ">CNPJ</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {payerIdentificationType} Number *
                    </label>
                    <input
                      type="text"
                      value={payerIdentificationNumber}
                      onChange={(e) => setPayerIdentificationNumber(e.target.value)}
                      placeholder={payerIdentificationType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleDeposit}
                disabled={
                  isLoading ||
                  !depositAmount ||
                  parseFloat(depositAmount) < 1 ||
                  !payerEmail ||
                  !payerFirstName ||
                  !payerLastName ||
                  !payerIdentificationNumber
                }
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
              >
                <QrCode className="w-5 h-5" />
                {isLoading ? 'Generating QR Code...' : 'Generate Pix QR Code'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Withdraw Tab */}
      {activeTab === 'withdraw' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Withdrawal Amount (BRL)
            </label>
            <input
              type="number"
              min="1"
              step="0.01"
              max={balance}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-lg"
            />
            <p className="text-xs text-gray-500 mt-1">
              Available: R$ {balance.toFixed(2)} | Minimum: R$ 1.00
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Pix Key
            </label>
            <input
              type="text"
              value={withdrawPixKey || (hasPixKey ? pixKey : '')}
              onChange={(e) => setWithdrawPixKey(e.target.value)}
              placeholder="CPF, email, phone, or random key"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            {hasPixKey && (
              <p className="text-xs text-gray-500 mt-1">
                Using saved Pix key. You can change it above.
              </p>
            )}
          </div>
          <button
            onClick={handleWithdraw}
            disabled={
              isLoading ||
              !withdrawAmount ||
              parseFloat(withdrawAmount) < 1 ||
              parseFloat(withdrawAmount) > balance ||
              !withdrawPixKey
            }
            className="w-full bg-gradient-to-r from-green-600 to-emerald-500 text-white py-3 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ArrowUpCircle className="w-5 h-5" />
            {isLoading ? 'Processing...' : 'Request Withdrawal'}
          </button>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>No transactions yet</p>
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {tx.type === 'deposit' ? (
                      <ArrowDownCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <ArrowUpCircle className="w-5 h-5 text-red-600" />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">
                        {tx.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(tx.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-bold ${
                        tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {tx.type === 'deposit' ? '+' : '-'}R$ {tx.amount.toFixed(2)}
                    </p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${getStatusColor(tx.status)}`}
                    >
                      {tx.status}
                    </span>
                  </div>
                </div>
                {tx.balanceAfter !== null && (
                  <p className="text-xs text-gray-500 mt-2">
                    Balance after: R$ {tx.balanceAfter.toFixed(2)}
                  </p>
                )}
                {tx.errorMessage && (
                  <p className="text-xs text-red-600 mt-2">{tx.errorMessage}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Pix Key
            </label>
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              placeholder="CPF, email, phone, or random key"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Save your Pix key for faster withdrawals
            </p>
          </div>
          <button
            onClick={handleSavePixKey}
            disabled={isLoading || !pixKey || pixKey.length < 3}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Save Pix Key'}
          </button>
        </div>
      )}
    </div>
  );
}

