import { useState, useEffect } from 'react';
import { Wallet, ArrowDownCircle, ArrowUpCircle, History, X, QrCode, Copy, Check } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from 'react-i18next';
import { API_ENDPOINTS } from '../config/api';

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
  const { t } = useTranslation();
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
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.PIX_KEY(userId));
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
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.TRANSACTIONS);
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
      showNotification(t('wallet.minimumDepositError'), 'error');
      return;
    }

    // Validate payer information
    if (!payerEmail || !payerFirstName || !payerLastName) {
      showNotification(t('wallet.fillPayerInfo'), 'error');
      return;
    }

    if (!payerIdentificationNumber) {
      showNotification(t('wallet.enterIdentification'), 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.DEPOSIT_REQUEST, {
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
        showNotification(t('wallet.pixNotConfigured'), 'info');
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        showNotification(data.error || t('wallet.depositFailed'), 'error');
        setIsLoading(false);
        return;
      }

      setQrCode(data.qrCode);
      setQrCodeBase64(data.qrCodeBase64);
      setQrExpiresAt(data.expiresAt);
      setTransactionId(data.transactionId);
      showNotification(t('wallet.qrCodeGenerated'), 'success');
      
      // Poll for status
      pollDepositStatus(data.transactionId);
    } catch (error) {
      showNotification(t('wallet.depositFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollDepositStatus = async (txId: string) => {
    if (!userId) return;
    const interval = setInterval(async () => {
      try {
        const { authenticatedFetch } = await import('../utils/api');
        const { API_ENDPOINTS } = await import('../config/api');
        const response = await authenticatedFetch(
          API_ENDPOINTS.PIX.DEPOSIT_STATUS(txId),
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'completed') {
            clearInterval(interval);
            showNotification(t('wallet.depositCompleted'), 'success');
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
      showNotification(t('wallet.minimumWithdrawalError'), 'error');
      return;
    }

    if (!withdrawPixKey || withdrawPixKey.length < 3) {
      showNotification(t('wallet.validPixKey'), 'error');
      return;
    }

    if (amount > balance) {
      showNotification(t('wallet.insufficientBalance'), 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.WITHDRAWAL_REQUEST, {
        method: 'POST',
        body: JSON.stringify({ amount, pixKey: withdrawPixKey }),
      });

      const data = await response.json();

      if (response.status === 503) {
        showNotification(t('wallet.pixNotAvailable'), 'info');
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        showNotification(data.error || t('wallet.withdrawalFailed'), 'error');
        setIsLoading(false);
        return;
      }

      showNotification(t('wallet.withdrawalRequestSubmitted'), 'success');
      setWithdrawAmount('');
      setWithdrawPixKey('');
      
      // Poll for status
      pollWithdrawalStatus(data.transactionId);
    } catch (error) {
      showNotification(t('wallet.withdrawalFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollWithdrawalStatus = async (txId: string) => {
    if (!userId) return;
    const interval = setInterval(async () => {
      try {
        const { API_ENDPOINTS } = await import('../config/api');
        const response = await fetch(
          `${API_ENDPOINTS.PIX.WITHDRAWAL_STATUS(txId)}?userId=${userId}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'completed') {
            clearInterval(interval);
            showNotification(t('wallet.withdrawalCompleted'), 'success');
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
      showNotification(t('wallet.validPixKey'), 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { authenticatedFetch } = await import('../utils/api');
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.PIX_KEY(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixKey }),
      });

      if (response.ok) {
        showNotification(t('wallet.pixKeySaved'), 'success');
        setHasPixKey(true);
        if (activeTab === 'withdraw') {
          setWithdrawPixKey(pixKey);
        }
      } else {
        const data = await response.json();
        showNotification(data.error || t('wallet.pixKeySaveFailed'), 'error');
      }
    } catch (error) {
      showNotification(t('wallet.pixKeySaveFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    showNotification(t('wallet.copiedToClipboard'), 'success');
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('wallet.title')}</h2>
          <p className="text-gray-600 mb-4">
            {t('wallet.pixComingSoon')}
          </p>
          <p className="text-sm text-gray-500">
            {t('wallet.pixDescription')}
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
          <h2 className="text-2xl font-bold text-gray-900">{t('wallet.title')}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-600">{t('wallet.balance')}</span>
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
          {t('wallet.deposit')}
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
          {t('wallet.withdraw')}
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
          {t('wallet.history')}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 font-semibold transition-colors ${
            activeTab === 'settings'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('wallet.settings')}
        </button>
      </div>

      {/* Deposit Tab */}
      {activeTab === 'deposit' && (
        <div className="space-y-4">
          {qrCode ? (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {t('wallet.scanQrCode')}
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
                <p className="text-xs text-gray-600 mb-2">{t('wallet.pixCopyPaste')}</p>
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
                  {t('wallet.expiresAt')} {new Date(qrExpiresAt).toLocaleString()}
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
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('wallet.depositAmount')}
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
                <p className="text-xs text-gray-500 mt-1">{t('wallet.minimumDeposit')}</p>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('wallet.payerInformation')}</h3>
                
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('wallet.firstName')}
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
                      {t('wallet.lastName')}
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
                    {t('wallet.email')}
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
                      {t('wallet.identificationType')}
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
                      {t('wallet.identificationNumber', { type: payerIdentificationType })}
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
                {isLoading ? t('wallet.generatingQrCode') : t('wallet.generateQrCode')}
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
              {t('wallet.withdrawalAmount')}
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
              {t('wallet.available')} R$ {balance.toFixed(2)} | {t('wallet.minimumWithdrawal')}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('wallet.pixKey')}
            </label>
            <input
              type="text"
              value={withdrawPixKey || (hasPixKey ? pixKey : '')}
              onChange={(e) => setWithdrawPixKey(e.target.value)}
              placeholder={t('wallet.pixKeyPlaceholder')}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            {hasPixKey && (
              <p className="text-xs text-gray-500 mt-1">
                {t('wallet.usingSavedPixKey')}
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
            {isLoading ? t('wallet.processing') : t('wallet.requestWithdrawal')}
          </button>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>{t('wallet.noTransactions')}</p>
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
                        {tx.type === 'deposit' ? t('wallet.deposit') : t('wallet.withdraw')}
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
              {t('wallet.yourPixKey')}
            </label>
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              placeholder={t('wallet.pixKeyPlaceholder')}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('wallet.savePixKeyDescription')}
            </p>
          </div>
          <button
            onClick={handleSavePixKey}
            disabled={isLoading || !pixKey || pixKey.length < 3}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t('wallet.saving') : t('wallet.savePixKey')}
          </button>
        </div>
      )}
    </div>
  );
}

