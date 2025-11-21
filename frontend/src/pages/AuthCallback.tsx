import { useState } from 'react';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';

interface AuthCallbackProps {
  userId: string;
  onUsernameSet: (userId: string) => void;
}

export default function AuthCallback({ userId, onUsernameSet }: AuthCallbackProps) {
  const { showNotification } = useNotification();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetUsername = async () => {
    if (!username.trim() || username.length < 3 || username.length > 20) {
      showNotification('Username must be between 3 and 20 characters', 'warning');
      return;
    }

    if (!userId) {
      showNotification('User ID not found', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/auth/set-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ userId, username: username.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to set username');
      }

      // Connect user via socket
      const socket = getSocket();
      if (socket) {
        socket.emit('user_connect', { userId });
        socket.once('connected', (data: { userId: string; username: string }) => {
          // Store display_username (second username) in localStorage
          localStorage.setItem('displayUsername', data.username);
          showNotification('Welcome!', 'success');
          onUsernameSet(data.userId);
        });
      } else {
        showNotification('Failed to connect to server', 'error');
      }
    } catch (error: any) {
      showNotification(error.message || 'Failed to set username', 'error');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Choose Your Username</h1>
          <p className="text-gray-600">Pick a username to get started</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
              placeholder="Enter username (3-20 characters)"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={20}
            />
            <p className="text-xs text-gray-500 mt-1">
              {username.length}/20 characters
            </p>
          </div>

          <button
            onClick={handleSetUsername}
            disabled={!username.trim() || username.length < 3 || loading}
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Setting username...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

