import { useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
import { clearAuth } from '../utils/api';
import { disconnectSocket } from '../utils/socket';
import { useDialog } from '../hooks/useDialog';
import { useTranslation } from 'react-i18next';
import PixWallet from './PixWallet';
import LanguageSwitcher from './LanguageSwitcher';
import logo from '../assets/logo.png';

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
  const [showWallet, setShowWallet] = useState(false);
  
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

  return (
    <>
    <header className="bg-white/90 backdrop-blur-sm shadow-sm sticky top-0 z-50">
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
            <span className="text-gray-700 font-medium">{displayUsername}</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'} animate-pulse`} />
              <span className="text-sm text-gray-600">
                {isConnected ? t('common.connected') : t('common.offline')}
              </span>
            </div>
            <LanguageSwitcher />
            {displayUsername !== t('common.guest') && currentUserId && (
              <button
                onClick={() => setShowWallet(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title={t('wallet.title')}
              >
                <Wallet className="w-4 h-4" />
                <span className="hidden sm:inline">{t('header.wallet')}</span>
              </button>
            )}
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
      {showWallet && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="relative max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <PixWallet userId={currentUserId} onClose={() => setShowWallet(false)} />
          </div>
        </div>
      )}
    </>
  );
}
