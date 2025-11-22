import { useState, useEffect } from 'react';
import Home from './pages/Home';
import GameRoom from './pages/GameRoom';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import AdminPanel from './pages/AdminPanel';
import { connectSocket, disconnectSocket, sendChatMessage, getSocket, connectUser, setNotificationHandler } from './utils/socket';
import { startVideo, closePeerConnection } from './utils/webrtc';
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import NotificationContainer from './components/Notification';
import { clearAuth } from './utils/api';
import { API_ENDPOINTS } from './config/api';

type Page = 'home' | 'game-room' | 'lobby' | 'login' | 'admin';

interface NavigationData {
  gameType?: 'tic-tac-toe' | 'checkers' | 'chess';
  keyword?: string;
  roomId?: string;
}

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [isConnected, setIsConnected] = useState(false);
  const [currentGameType, setCurrentGameType] = useState<'tic-tac-toe' | 'checkers' | 'chess'>('tic-tac-toe');
  const [currentRoomId, setCurrentRoomId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const { notifications, removeNotification, showNotification } = useNotification();

  useEffect(() => {
    // Set up notification handler for socket errors
    setNotificationHandler((message, type = 'error') => {
      showNotification(message, type);
    });
  }, [showNotification]);

  useEffect(() => {
    // Check if we're on admin route
    if (window.location.pathname === '/admin') {
      setCurrentPage('admin');
      return;
    }

    // Check for stored token and auto-login
    const storedToken = localStorage.getItem('authToken');
    const storedUserId = localStorage.getItem('userId');
    const storedUsername = localStorage.getItem('username');

    if (storedToken && storedUserId && storedUsername) {
      // Verify token is still valid
      fetch(API_ENDPOINTS.AUTH.VERIFY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: storedToken }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid && !data.banned) {
            // Token is valid, restore user session
            setUserId(data.userId);
            setUsername(data.username);
            setCurrentPage('home');
            
            // Connect socket with token (socket will auto-connect user on connect)
            const socket = connectSocket();
            socket.on('connect', () => {
              setIsConnected(true);
            });
          } else {
            // Token invalid or expired, clear storage
            localStorage.removeItem('authToken');
            localStorage.removeItem('userId');
            localStorage.removeItem('username');
            localStorage.removeItem('userType');
            setCurrentPage('login');
          }
        })
        .catch(() => {
          // Error verifying token, clear storage
          localStorage.removeItem('authToken');
          localStorage.removeItem('userId');
          localStorage.removeItem('username');
          localStorage.removeItem('userType');
          setCurrentPage('login');
        });
    } else {
      // No token, show login
      setCurrentPage('login');
    }

    const socket = connectSocket();

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('connected', (data: { userId: string; username: string }) => {
      console.log('User connected:', data);
      setUsername(data.username);
      setUserId(data.userId);
      // Store display_username (second username) in localStorage
      localStorage.setItem('displayUsername', data.username);
    });

    // Don't disconnect on cleanup - keep socket alive for the app lifetime
    // return () => {
    //   disconnectSocket();
    // };
  }, []);

  const handleNavigate = (page: string, data?: NavigationData) => {
    setCurrentPage(page as Page);
    if (data?.gameType) {
      setCurrentGameType(data.gameType);
    }
    if (data?.roomId) {
      setCurrentRoomId(data.roomId);
    }
  };

  const handleAuthSuccess = (authUserId: string, authUsername: string) => {
    setUserId(authUserId);
    setUsername(authUsername);
    // Connect via socket
    const socket = getSocket();
    if (socket) {
      socket.emit('user_connect', { userId: authUserId });
      socket.once('connected', (data: { userId: string; username: string }) => {
        setUsername(data.username);
        // Store display_username (second username) in localStorage
        localStorage.setItem('displayUsername', data.username);
        setCurrentPage('home');
      });
    } else {
      // If socket not ready, still navigate to home
      setCurrentPage('home');
    }
  };

  const handleSendMessage = (message: string) => {
    console.log('App: Sending message to room:', currentRoomId, 'Message:', message);
    sendChatMessage(currentRoomId, message);
  };

  const handleStartVideo = async () => {
    try {
      await startVideo();
      console.log('Video started successfully');
    } catch (error) {
      console.error('Failed to start video:', error);
    }
  };

  const handleEndCall = () => {
    closePeerConnection();
    console.log('Call ended');
  };

  const handleRematch = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('rematch_request', { roomId: currentRoomId });
    }
    console.log('Rematch requested');
  };

  const handleExitRoom = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('leave_room', { roomId: currentRoomId });
    }
    setCurrentPage('home');
    console.log('Exited room');
  };

  const handleLogout = () => {
    // Clear auth data and disconnect socket
    clearAuth();
    disconnectSocket();
    
    // Reset state
    setUserId('');
    setUsername('');
    setCurrentPage('login');
  };

  return (
    <>
      <NotificationContainer notifications={notifications} onClose={removeNotification} />
      {currentPage === 'login' && (
        <Login onAuthSuccess={handleAuthSuccess} />
      )}
      {currentPage === 'home' && userId && (
        <Home 
          onNavigate={handleNavigate} 
          isConnected={isConnected} 
          username={username}
          onLogout={handleLogout}
          userId={userId}
        />
      )}
      {currentPage === 'game-room' && userId && (
        <GameRoom
          gameType={currentGameType}
          roomId={currentRoomId}
          userId={userId}
          onNavigate={handleNavigate}
          isConnected={isConnected}
          onSendMessage={handleSendMessage}
          onStartVideo={handleStartVideo}
          onEndCall={handleEndCall}
          onRematch={handleRematch}
          onExitRoom={handleExitRoom}
          onLogout={handleLogout}
        />
      )}
      {currentPage === 'lobby' && userId && (
        <Lobby onNavigate={handleNavigate} isConnected={isConnected} userId={userId} />
      )}
      {currentPage === 'admin' && (
        <AdminPanel />
      )}
      {/* Fallback: Always show login if no page matches */}
      {currentPage !== 'login' && currentPage !== 'home' && currentPage !== 'game-room' && currentPage !== 'lobby' && currentPage !== 'admin' && (
        <Login onAuthSuccess={handleAuthSuccess} />
      )}
    </>
  );
}

function App() {
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}

export default App;
