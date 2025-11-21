import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';
import ticTacToeLogo from '../assets/tic-tac-toe.png';
import checkersLogo from '../assets/checkers.png';
import chessLogo from '../assets/chess.png';

interface HomeProps {
  onNavigate: (page: string, data?: { gameType?: string; keyword?: string; roomId?: string }) => void;
  isConnected: boolean;
  username?: string;
  onLogout?: () => void;
  userId?: string;
}

export default function Home({ onNavigate, isConnected, username: propUsername, onLogout, userId }: HomeProps) {
  const { t } = useTranslation();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [showUsernameForm, setShowUsernameForm] = useState(false);
  // Check if displayUsername exists in localStorage (user has already set second username)
  const [isUsernameSet, setIsUsernameSet] = useState(() => {
    return !!localStorage.getItem('displayUsername');
  });
  const { showNotification } = useNotification();

  // Check for displayUsername on mount and when userId changes
  useEffect(() => {
    const displayUsername = localStorage.getItem('displayUsername');
    if (displayUsername) {
      setIsUsernameSet(true);
      setUsername(displayUsername); // Pre-fill the form with current username
    }
  }, [userId]);

  const games = [
    {
      id: 'tic-tac-toe',
      name: t('home.games.ticTacToe.name'),
      logo: ticTacToeLogo,
      color: 'from-blue-500 to-cyan-500',
      description: t('home.games.ticTacToe.description'),
    },
    {
      id: 'checkers',
      name: t('home.games.checkers.name'),
      logo: checkersLogo,
      color: 'from-red-500 to-orange-500',
      description: t('home.games.checkers.description'),
    },
    {
      id: 'chess',
      name: t('home.games.chess.name'),
      logo: chessLogo,
      color: 'from-purple-500 to-pink-500',
      description: t('home.games.chess.description'),
    },
  ];

  const handleSetUsername = async () => {
    if (!username.trim() || username.length < 3 || username.length > 20) {
      showNotification(t('home.usernameLengthError'), 'warning');
      return;
    }

    if (!userId) {
      showNotification(t('home.userIdNotFound'), 'error');
      return;
    }

    try {
      // Set the second username (display username for rooms)
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
        throw new Error(error.error || t('home.failedToSetUsername'));
      }

      // Connect user via socket after setting username
      const socket = getSocket();
      if (socket) {
        socket.emit('user_connect', { userId });
        socket.once('connected', (data: { userId: string; username: string }) => {
          // Store display_username (second username) in localStorage
          localStorage.setItem('displayUsername', data.username);
          showNotification(t('home.usernameUpdated'), 'success');
          setIsUsernameSet(true);
          setShowUsernameForm(false); // Hide form after successful update
        });
      } else {
        showNotification(t('home.failedToConnect'), 'error');
      }
    } catch (error: any) {
      showNotification(error.message || t('home.failedToSetUsername'), 'error');
    }
  };

  const handleRandomMatch = (gameType: string) => {
    if (!isUsernameSet) {
      showNotification(t('home.usernameRequired'), 'warning');
      return;
    }
    setSelectedGame(gameType);
    // Convert game type format (tic-tac-toe -> tic_tac_toe)
    const backendGameType = gameType.replace(/-/g, '_');
    const socket = getSocket();
    if (socket) {
      console.log('Attempting to join random match for:', backendGameType);
      console.log('Socket connected:', socket.connected);
      console.log('Socket ID:', socket.id);
      
      // Set up event listeners before emitting
      const handleGameStart = (data: any) => {
        console.log('Game started:', data);
        socket.off('game_start', handleGameStart);
        socket.off('waiting_for_player', handleWaiting);
        socket.off('error', handleError);
        // Ensure roomId is passed
        if (data.roomId) {
          onNavigate('game-room', { gameType, roomId: data.roomId });
        }
      };
      
      const handleWaiting = (data: any) => {
        console.log('Waiting for player:', data);
        socket.off('game_start', handleGameStart);
        socket.off('waiting_for_player', handleWaiting);
        socket.off('error', handleError);
        // Ensure roomId is passed
        if (data.roomId) {
          onNavigate('game-room', { gameType, roomId: data.roomId });
        }
      };
      
      const handleError = (error: any) => {
        console.error('Error joining room:', error);
        showNotification(error.message || 'Failed to join room', 'error');
        socket.off('game_start', handleGameStart);
        socket.off('waiting_for_player', handleWaiting);
        socket.off('error', handleError);
      };
      
      socket.on('game_start', handleGameStart);
      socket.on('waiting_for_player', handleWaiting);
      socket.on('error', handleError);
      
      console.log('Emitting join_random with gameType:', backendGameType);
      socket.emit('join_random', { gameType: backendGameType });
    } else {
      console.error('Socket is null!');
      showNotification(t('home.notConnected'), 'error');
    }
  };

  if (!isUsernameSet) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
        <Header isConnected={isConnected} username={propUsername || username} onLogout={onLogout} userId={userId} onNavigate={onNavigate} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-md mx-auto mt-20">
            <div className="bg-white rounded-2xl shadow-lg p-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-4 text-center">
                {t('home.welcomeTitle')}
              </h2>
              <p className="text-gray-600 mb-6 text-center">
                {t('home.enterUsername')}
              </p>
              <div className="space-y-4">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('home.usernamePlaceholder')}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
                />
                <button
                  onClick={handleSetUsername}
                  disabled={!username.trim() || !isConnected}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnected ? t('common.continue') : t('common.connecting')}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex flex-col">
      <Header isConnected={isConnected} userId={userId} onNavigate={onNavigate} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex-1 flex flex-col">
        {/* Username change section */}
        {isUsernameSet && (
          <div className="mb-6 flex justify-end">
            <button
              onClick={() => setShowUsernameForm(!showUsernameForm)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showUsernameForm ? t('home.hideUsername') : t('home.changeUsername')}
            </button>
          </div>
        )}

        {showUsernameForm && isUsernameSet && (
          <div className="max-w-md mx-auto mb-8">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4 text-center">
                {t('home.updateUsername')}
              </h3>
              <p className="text-gray-600 mb-4 text-center text-sm">
                {t('home.updateUsernameDescription')}
              </p>
              <div className="space-y-4">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('home.usernamePlaceholderNew')}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
                  maxLength={20}
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleSetUsername}
                    disabled={!username.trim() || username.length < 3 || !isConnected}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConnected ? t('home.updateUsername') : t('common.connecting')}
                  </button>
                  <button
                    onClick={() => {
                      setShowUsernameForm(false);
                      setUsername(localStorage.getItem('displayUsername') || '');
                    }}
                    className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {username.length}/20 {t('home.characters')}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col justify-center">
          <div className="text-center mb-16 animate-fade-in">
            <h2 className="text-5xl font-bold text-gray-900 mb-4">
              {t('home.playChatCompete')}
            </h2>
            <p className="text-xl text-gray-600">
              {t('home.joinFriends')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {games.map((game) => {
              return (
                <div
                  key={game.id}
                  className={`bg-white rounded-2xl shadow-lg p-6 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl ${
                    selectedGame === game.id ? 'ring-4 ring-blue-500 ring-offset-2' : ''
                  }`}
                  onClick={() => setSelectedGame(game.id)}
                >
                  <div className="w-32 h-32 mb-4 mx-auto flex items-center justify-center">
                    <img 
                      src={game.logo} 
                      alt={game.name} 
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 text-center mb-2">
                    {game.name}
                  </h3>
                  <p className="text-gray-600 text-center text-sm">{game.description}</p>
                </div>
              );
            })}
          </div>

          {selectedGame && (
            <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-lg p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Users className="w-6 h-6 text-blue-600" />
                  <h3 className="text-2xl font-bold text-gray-900">
                    {t('home.connectToMatch')}
                  </h3>
                </div>

                <button
                  onClick={() => handleRandomMatch(selectedGame)}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-4 rounded-xl font-semibold text-lg hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl mb-6"
                >
                  {t('home.playRandomMatch')}
                </button>

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
