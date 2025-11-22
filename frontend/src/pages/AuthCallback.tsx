import { useState } from 'react';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from 'react-i18next';

interface AuthCallbackProps {
  userId: string;
  onUsernameSet: (userId: string) => void;
}

export default function AuthCallback({ userId, onUsernameSet }: AuthCallbackProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetUsername = async () => {
    if (!username.trim() || username.length < 3 || username.length > 20) {
      showNotification(t('home.usernameLengthError'), 'warning');
      return;
    }

    if (!userId) {
      showNotification(t('home.userIdNotFound'), 'error');
      return;
    }

    setLoading(true);
    try {
      const { API_ENDPOINTS } = await import('../config/api');
      const response = await fetch(API_ENDPOINTS.AUTH.SET_USERNAME, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ userId, username: username.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('home.failedToSetUsername'));
      }

      // Connect user via socket
      const socket = getSocket();
      if (socket) {
        socket.emit('user_connect', { userId });
        socket.once('connected', (data: { userId: string; username: string }) => {
          // Store display_username (second username) in localStorage
          localStorage.setItem('displayUsername', data.username);
          showNotification(t('authCallback.welcome'), 'success');
          onUsernameSet(data.userId);
        });
      } else {
        showNotification(t('home.failedToConnect'), 'error');
      }
    } catch (error: any) {
      showNotification(error.message || t('home.failedToSetUsername'), 'error');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('authCallback.title')}</h1>
          <p className="text-gray-600">{t('authCallback.subtitle')}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('authCallback.usernameLabel')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
              placeholder={t('authCallback.usernamePlaceholder')}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={20}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('authCallback.charactersCount', { count: username.length })}
            </p>
          </div>

          <button
            onClick={handleSetUsername}
            disabled={!username.trim() || username.length < 3 || loading}
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('authCallback.settingUsername') : t('authCallback.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

