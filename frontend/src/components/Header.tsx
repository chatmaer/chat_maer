import { useState } from 'react';
import { LogOut, Sparkles, X, QrCode, Copy, Check } from 'lucide-react';
import { clearAuth, authenticatedFetch } from '../utils/api';
import { disconnectSocket } from '../utils/socket';
import { useDialog } from '../hooks/useDialog';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../contexts/NotificationContext';
import LanguageSwitcher from './LanguageSwitcher';
import logo from '../assets/logo.png';
import homeLogo from '../assets/home_logo.png';
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
      <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white sticky top-0 z-40 shadow-md animate-pulse min-h-[3.5rem] sm:min-h-[3.75rem] flex items-center">
        <div className="max-w-7xl mx-auto px-2 sm:px-3 md:px-4 w-full py-2.5 sm:py-3">
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium">
            <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
            <span 
              className="text-center leading-relaxed flex-1 min-w-0" 
              style={{ 
                wordBreak: 'break-word', 
                overflowWrap: 'break-word',
                hyphens: 'auto',
                WebkitHyphens: 'auto',
                msHyphens: 'auto'
              }}
            >
              {t('header.updateDonationMessage')}
            </span>
          </div>
        </div>
      </div>
    )}
    <header className={`bg-white/90 backdrop-blur-sm shadow-sm sticky z-50 ${displayUsername !== t('common.guest') && currentUserId ? 'top-[3.5rem] sm:top-[3.75rem]' : 'top-0'}`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-2.5 sm:py-3 md:py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
            {/* Show home_logo on mobile/small screens, regular logo on larger screens */}
            <img 
              src={homeLogo} 
              alt="Logo" 
              className="h-6 sm:h-7 md:h-8 lg:h-9 xl:h-10 w-auto cursor-pointer active:opacity-80 sm:hover:opacity-80 transition-opacity touch-manipulation md:hidden" 
              onClick={handleLogoClick}
            />
            <img 
              src={logo} 
              alt="Logo" 
              className="h-8 sm:h-9 md:h-10 w-auto cursor-pointer active:opacity-80 sm:hover:opacity-80 transition-opacity touch-manipulation hidden md:block" 
              onClick={handleLogoClick}
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-4 min-w-0 flex-shrink">
            {displayUsername !== t('common.guest') && currentUserId && (
              <button
                onClick={handleUpdatePlatform}
                disabled={isUpdating}
                className="relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-white bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 rounded-lg shadow-lg active:shadow-xl sm:hover:shadow-xl transform active:scale-95 sm:hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group animate-pulse touch-manipulation min-h-[36px] sm:min-h-[40px]"
                title={t('header.updateButton')}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 relative z-10 drop-shadow-lg flex-shrink-0" />
                <span className="relative z-10 drop-shadow-lg whitespace-nowrap">{t('header.updateButton')}</span>
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
              </button>
            )}
            <span className="text-gray-700 font-medium text-xs sm:text-sm md:text-base truncate max-w-[40px] xs:max-w-[50px] sm:max-w-[80px] md:max-w-[120px] lg:max-w-none" title={displayUsername}>{displayUsername}</span>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'} animate-pulse`} />
              <span className="text-xs sm:text-sm text-gray-600 hidden sm:inline">
                {isConnected ? t('common.connected') : t('common.offline')}
              </span>
            </div>
            <LanguageSwitcher />
            {displayUsername !== t('common.guest') && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 active:text-red-600 active:bg-red-50 sm:hover:text-red-600 sm:hover:bg-red-50 rounded-lg transition-colors touch-manipulation min-h-[36px] sm:min-h-[40px]"
                title={t('common.logout')}
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="hidden sm:inline">{t('common.logout')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
      {DialogComponent}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6">
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
              className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-400 active:text-gray-600 sm:hover:text-gray-600 transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            
            {updateQrCode ? (
              <div className="text-center">
                <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-purple-600 mx-auto mb-3 sm:mb-4" />
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{t('header.updatePlatform')}</h2>
                <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 px-2">{t('header.updateDescription')}</p>
                {updateQrCodeBase64 && (
                  <div className="mb-3 sm:mb-4">
                    <img
                      src={updateQrCodeBase64}
                      alt="Pix QR Code"
                      className="mx-auto w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 border-2 border-gray-300 rounded-lg"
                    />
                  </div>
                )}
                <div className="bg-white p-3 sm:p-4 rounded-lg mb-3 sm:mb-4 border-2 border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">{t('wallet.pixCopyPaste')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs break-all p-2 bg-gray-100 rounded overflow-x-auto">
                      {updateQrCode}
                    </code>
                    <button
                      onClick={() => copyToClipboard(updateQrCode)}
                      className="p-2 sm:p-2.5 bg-blue-600 text-white rounded active:bg-blue-700 sm:hover:bg-blue-700 transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
                    >
                      {copied ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : <Copy className="w-4 h-4 sm:w-5 sm:h-5" />}
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
                <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                  <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600 flex-shrink-0" />
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t('header.updatePlatform')}</h2>
                    <p className="text-xs sm:text-sm text-gray-600">{t('header.updateDescription')}</p>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-3 sm:pt-4 mt-3 sm:mt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('wallet.payerInformation')}</h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                        {t('wallet.firstName')}
                      </label>
                      <input
                        type="text"
                        value={payerFirstName}
                        onChange={(e) => setPayerFirstName(e.target.value)}
                        placeholder="John"
                        className="w-full px-3 sm:px-4 py-2 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                        {t('wallet.lastName')}
                      </label>
                      <input
                        type="text"
                        value={payerLastName}
                        onChange={(e) => setPayerLastName(e.target.value)}
                        placeholder="Doe"
                        className="w-full px-3 sm:px-4 py-2 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                      {t('wallet.email')}
                    </label>
                    <input
                      type="email"
                      value={payerEmail}
                      onChange={(e) => setPayerEmail(e.target.value)}
                      placeholder="john.doe@example.com"
                      className="w-full px-3 sm:px-4 py-2 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                        {t('wallet.identificationType')}
                      </label>
                      <select
                        value={payerIdentificationType}
                        onChange={(e) => setPayerIdentificationType(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      >
                        <option value="CPF">CPF</option>
                        <option value="CNPJ">CNPJ</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                        {t('wallet.identificationNumber', { type: payerIdentificationType })}
                      </label>
                      <input
                        type="text"
                        value={payerIdentificationNumber}
                        onChange={(e) => setPayerIdentificationNumber(e.target.value)}
                        placeholder={payerIdentificationType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'}
                        className="w-full px-3 sm:px-4 py-2 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                  className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white py-2.5 sm:py-3 rounded-xl font-semibold active:shadow-xl sm:hover:shadow-xl transform active:scale-95 sm:hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-3 sm:mt-4 touch-manipulation min-h-[48px] text-sm sm:text-base"
                >
                  <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
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
