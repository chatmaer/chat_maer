import { useState } from 'react';
import { LogOut, Sparkles, X, QrCode, Copy, Check } from 'lucide-react';
import { clearAuth, authenticatedFetch } from '../utils/api';
import { disconnectSocket } from '../utils/socket';
import { useDialog } from '../hooks/useDialog';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../contexts/NotificationContext';
import LanguageSwitcher from './LanguageSwitcher';
import logo from '../assets/logo.png';
import { API_ENDPOINTS } from '../config/api';

interface HeaderProps {
  username?: string;
  isConnected: boolean;
  onLogout?: () => void;
  userId?: string;
  onNavigate?: (page: string) => void;
}

export default function Header({ username, isConnected, onLogout, userId, onNavigate }: HeaderProps) {
  const { t } = useTranslation();
  // Get display_username (second username) from localStorage or props, fallback to first username
  const displayUsername = username || localStorage.getItem('displayUsername') || localStorage.getItem('username') || t('common.guest');
  const { showConfirm, DialogComponent } = useDialog();
  const { showNotification } = useNotification();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateQrCode, setUpdateQrCode] = useState<string | null>(null);
  const [updateQrCodeBase64, setUpdateQrCodeBase64] = useState<string | null>(null);
  const [updateTransactionId, setUpdateTransactionId] = useState<string | null>(null);
  const [updateExpiresAt, setUpdateExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  // Payer information for platform update
  const [payerEmail, setPayerEmail] = useState<string>('');
  const [payerFirstName, setPayerFirstName] = useState<string>('');
  const [payerLastName, setPayerLastName] = useState<string>('');
  const [payerIdentificationType, setPayerIdentificationType] = useState<string>('CPF');
  const [payerIdentificationNumber, setPayerIdentificationNumber] = useState<string>('');
  
  // Get userId from localStorage if not provided
  const currentUserId = userId || localStorage.getItem('userId') || '';

  const handleLogout = async () => {
    const confirmed = await showConfirm(t('header.logoutConfirm'), {
      type: 'warning',
      title: t('header.logoutTitle'),
      confirmText: t('common.logout'),
      cancelText: t('common.cancel'),
    });

    if (confirmed) {
      // Clear authentication data
      clearAuth();
      
      // Disconnect socket
      disconnectSocket();
      
      // Call onLogout callback if provided
      if (onLogout) {
        onLogout();
      } else {
        // Default: redirect to login
        window.location.href = '/';
      }
    }
  };

  const handleLogoClick = () => {
    if (onNavigate) {
      onNavigate('home');
    } else {
      // Fallback: use window location
      window.location.href = '/';
    }
  };

  const handleUpdatePlatform = async () => {
    if (!currentUserId) {
      showNotification(t('header.updateLoginRequired'), 'error');
      return;
    }

    // If QR code is already shown, just open the modal
    if (updateQrCode) {
      setShowUpdateModal(true);
      return;
    }

    // Open modal first to show the form
    setShowUpdateModal(true);
  };

  const handleSubmitUpdate = async () => {
    if (!currentUserId) {
      showNotification(t('header.updateLoginRequired'), 'error');
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

    setIsUpdating(true);
    try {
      // Create platform update request (1 R$ via Pix)
      const response = await authenticatedFetch(API_ENDPOINTS.PIX.PLATFORM_UPDATE_REQUEST, {
        method: 'POST',
        body: JSON.stringify({
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
        setIsUpdating(false);
        return;
      }

      if (!response.ok) {
        showNotification(data.error || t('header.updateFailed'), 'error');
        setIsUpdating(false);
        return;
      }

      setUpdateQrCode(data.qrCode);
      setUpdateQrCodeBase64(data.qrCodeBase64);
      setUpdateTransactionId(data.transactionId);
      setUpdateExpiresAt(data.expiresAt);
      showNotification(t('header.updateQrCodeGenerated'), 'success');
      
      // Poll for status
      pollUpdateStatus(data.transactionId);
    } catch (error) {
      showNotification(t('header.updateFailed'), 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    showNotification(t('wallet.copiedToClipboard'), 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const pollUpdateStatus = async (txId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await authenticatedFetch(
          API_ENDPOINTS.PIX.PLATFORM_UPDATE_STATUS(txId),
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'completed') {
            clearInterval(interval);
            showNotification(t('header.updateCompleted'), 'success');
            setShowUpdateModal(false);
            setUpdateQrCode(null);
            setUpdateQrCodeBase64(null);
            setUpdateTransactionId(null);
            setUpdateExpiresAt(null);
            // Reset payer info
            setPayerEmail('');
            setPayerFirstName('');
            setPayerLastName('');
            setPayerIdentificationNumber('');
          } else if (data.status === 'failed') {
            clearInterval(interval);
            showNotification(data.errorMessage || t('header.updateFailed'), 'error');
            setShowUpdateModal(false);
            setUpdateQrCode(null);
            setUpdateQrCodeBase64(null);
            setUpdateTransactionId(null);
            setUpdateExpiresAt(null);
          }
        }
      } catch (error) {
        console.error('Error polling update status:', error);
      }
    }, 3000); // Poll every 3 seconds

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  return (
    <>
    {/* Fixed donation message banner */}
    {displayUsername !== t('common.guest') && currentUserId && (
      <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white py-2.5 px-4 sticky top-0 z-40 shadow-md animate-pulse">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm font-medium">
          <Sparkles className="w-4 h-4" />
          <span>{t('header.updateDonationMessage')}</span>
        </div>
      </div>
    )}
    <header className={`bg-white/90 backdrop-blur-sm shadow-sm sticky z-50 ${displayUsername !== t('common.guest') && currentUserId ? 'top-[2.5rem]' : 'top-0'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={logo} 
              alt="Logo" 
              className="h-10 w-auto cursor-pointer hover:opacity-80 transition-opacity" 
              onClick={handleLogoClick}
            />
          </div>

          <div className="flex items-center gap-4">
            {displayUsername !== t('common.guest') && currentUserId && (
              <button
                onClick={handleUpdatePlatform}
                disabled={isUpdating}
                className="relative flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group animate-pulse"
                title={t('header.updateButton')}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <Sparkles className="w-4 h-4 relative z-10 drop-shadow-lg" />
                <span className="relative z-10 drop-shadow-lg">{t('header.updateButton')}</span>
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
              </button>
            )}
            <span className="text-gray-700 font-medium">{displayUsername}</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'} animate-pulse`} />
              <span className="text-sm text-gray-600">
                {isConnected ? t('common.connected') : t('common.offline')}
              </span>
            </div>
            <LanguageSwitcher />
            {displayUsername !== t('common.guest') && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title={t('common.logout')}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{t('common.logout')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
      {DialogComponent}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <button
              onClick={() => {
                setShowUpdateModal(false);
                if (updateQrCode) {
                  setUpdateQrCode(null);
                  setUpdateQrCodeBase64(null);
                  setUpdateTransactionId(null);
                  setUpdateExpiresAt(null);
                }
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            
            {updateQrCode ? (
              <div className="text-center">
                <Sparkles className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('header.updatePlatform')}</h2>
                <p className="text-gray-600 mb-4">{t('header.updateDescription')}</p>
                {updateQrCodeBase64 && (
                  <div className="mb-4">
                    <img
                      src={updateQrCodeBase64}
                      alt="Pix QR Code"
                      className="mx-auto w-64 h-64 border-2 border-gray-300 rounded-lg"
                    />
                  </div>
                )}
                <div className="bg-white p-4 rounded-lg mb-4 border-2 border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">{t('wallet.pixCopyPaste')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs break-all p-2 bg-gray-100 rounded">
                      {updateQrCode}
                    </code>
                    <button
                      onClick={() => copyToClipboard(updateQrCode)}
                      className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {updateExpiresAt && (
                  <p className="text-sm text-gray-600 mb-4">
                    {t('wallet.expiresAt')} {new Date(updateExpiresAt).toLocaleString()}
                  </p>
                )}
                <p className="text-sm text-gray-500">{t('header.updateAmount')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-6">
                  <Sparkles className="w-8 h-8 text-purple-600" />
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{t('header.updatePlatform')}</h2>
                    <p className="text-sm text-gray-600">{t('header.updateDescription')}</p>
                  </div>
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
                  onClick={handleSubmitUpdate}
                  disabled={
                    isUpdating ||
                    !payerEmail ||
                    !payerFirstName ||
                    !payerLastName ||
                    !payerIdentificationNumber
                  }
                  className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white py-3 rounded-xl font-semibold hover:shadow-xl transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                >
                  <QrCode className="w-5 h-5" />
                  {isUpdating ? t('wallet.generatingQrCode') : t('header.generateQrCode')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
