import { io, Socket } from 'socket.io-client';

// We'll export a function to set the notification handler
let notificationHandler: ((message: string, type?: 'error' | 'success' | 'info' | 'warning') => void) | null = null;

export const setNotificationHandler = (handler: (message: string, type?: 'error' | 'success' | 'info' | 'warning') => void) => {
  notificationHandler = handler;
};

const showNotification = (message: string, type: 'error' | 'success' | 'info' | 'warning' = 'error') => {
  if (notificationHandler) {
    notificationHandler(message, type);
  } else {
    // Fallback to console if handler not set
    console.error('Notification:', message);
  }
};

let socket: Socket | null = null;

export const connectSocket = (url: string = 'http://localhost:3001'): Socket => {
  if (!socket || !socket.connected) {
    // If socket exists but is disconnected, clean it up first
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    
    // Get token from localStorage for authentication
    const token = localStorage.getItem('authToken');
    
    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      auth: token ? { token } : undefined,
    });

    socket.on('connect', () => {
      console.log('Connected to server:', socket?.id);
      
      // If we have a token, automatically connect user
      const currentToken = localStorage.getItem('authToken');
      if (currentToken) {
        socket?.emit('user_connect', { token: currentToken });
      }
    });

    // Handle session termination (when logged in from another device)
    socket.on('session_terminated', (data: { message: string; reason: string }) => {
      console.log('Session terminated:', data);
      if (notificationHandler) {
        notificationHandler(data.message || 'You have been logged in from another device', 'warning');
      }
      // Clear auth and redirect to login
      localStorage.removeItem('authToken');
      localStorage.removeItem('userId');
      localStorage.removeItem('username');
      localStorage.removeItem('displayUsername');
      localStorage.removeItem('userType');
      // Disconnect socket
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      // Redirect to login after a short delay
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server, reason:', reason);
      // Don't set socket to null on disconnect - allow reconnection
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected to server after', attemptNumber, 'attempts');
      const currentToken = localStorage.getItem('authToken');
      if (currentToken) {
        socket?.emit('user_connect', { token: currentToken });
      }
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });
  }

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = (): Socket | null => {
  // If socket is null or disconnected, try to reconnect
  if (!socket || !socket.connected) {
    console.log('Socket is null or disconnected, reconnecting...');
    return connectSocket();
  }
  return socket;
};

export const emitMove = (gameType: string, move: unknown) => {
  if (socket) {
    console.log('emitMove called:', { gameType, move, socketConnected: socket.connected });
    socket.emit('player_move', { gameType, move });
    
    // Listen for error response
    socket.once('error', (error: any) => {
      console.error('Move error:', error);
      if (error.message) {
        showNotification(`Move failed: ${error.message}`, 'error');
      }
    });
  } else {
    console.error('Cannot emit move - socket is null');
    showNotification('Not connected to server. Please refresh the page.', 'error');
  }
};

export const sendChatMessage = (roomId: string, message: string) => {
  if (socket) {
    socket.emit('chat_message', { message });
  }
};

export const joinRandomMatch = (gameType: string, callback: (data: unknown) => void) => {
  const currentSocket = getSocket();
  if (currentSocket) {
    currentSocket.emit('join_random', { gameType });
    currentSocket.once('game_start', callback);
    currentSocket.once('waiting_for_player', callback);
  } else {
    console.error('Cannot join random match - socket is null');
  }
};

export const joinByKeyword = (keyword: string, gameType: string, callback: (data: unknown) => void) => {
  const currentSocket = getSocket();
  if (currentSocket) {
    currentSocket.emit('join_keyword', { gameType, keyword });
    currentSocket.once('game_start', callback);
    currentSocket.once('waiting_for_player', callback);
  } else {
    console.error('Cannot join by keyword - socket is null');
  }
};

export const connectUser = (userId: string) => {
  const currentSocket = getSocket();
  if (currentSocket) {
    const token = localStorage.getItem('authToken');
    console.log('Emitting user_connect with userId:', userId, 'token:', !!token, 'socket connected:', currentSocket.connected);
    // Prefer token if available, otherwise use userId
    if (token) {
      currentSocket.emit('user_connect', { token });
    } else {
      currentSocket.emit('user_connect', { userId });
    }
  } else {
    console.error('Cannot connect user - socket is null');
  }
};

export const requestRematch = (roomId: string) => {
  if (socket) {
    socket.emit('rematch_request');
  }
};

export const leaveRoom = (roomId: string) => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const onChatMessage = (callback: (data: { sender: string; message: string }) => void) => {
  if (socket) {
    socket.on('chat_message', callback);
  }
};

export const onGameUpdate = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on('game_update', callback);
  }
};

export const offChatMessage = () => {
  if (socket) {
    socket.off('chat_message');
  }
};

export const offGameUpdate = () => {
  if (socket) {
    socket.off('game_update');
  }
};

export const emitPawnPromotion = (position: { x: number; y: number }, promotionType: string) => {
  if (socket) {
    socket.emit('pawn_promotion', {
      position,
      promotionType,
      gameType: 'chess',
    });
  } else {
    console.error('Cannot emit promotion - socket is null');
  }
};
