import { useState, useEffect, useRef, useCallback } from 'react';
import { RotateCcw, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import GameBoard from '../components/GameBoard';
import GameInfoPanel from '../components/GameInfoPanel';
import ChatPanel from '../components/ChatPanel';
import VideoPanel from '../components/VideoPanel';
import { getSocket } from '../utils/socket';
import { useNotification } from '../contexts/NotificationContext';

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isOwn: boolean;
}

interface GameRoomProps {
  gameType: 'tic-tac-toe' | 'checkers' | 'chess';
  roomId?: string;
  userId?: string;
  onNavigate: (page: string) => void;
  isConnected: boolean;
  onSendMessage: (message: string) => void;
  onStartVideo: () => void;
  onRematch: () => void;
  onExitRoom: () => void;
  onLogout?: () => void;
}

export default function GameRoom({
  gameType,
  roomId,
  userId: propUserId,
  onNavigate,
  isConnected,
  onSendMessage,
  onStartVideo,
  onRematch,
  onExitRoom,
  onLogout,
}: GameRoomProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: '1',
      sender: 'System',
      text: 'Welcome to the game room! Good luck!',
      timestamp: new Date(),
      isOwn: false,
    },
  ]);

  // Update initial message with translation when component mounts or language changes
  useEffect(() => {
    setMessages((prev) => {
      // Find the system message (by ID '1' or by checking if it's the system sender)
      const systemMessageIndex = prev.findIndex(msg => msg.id === '1' || msg.sender === t('gameRoom.system') || msg.sender === 'System');
      
      if (systemMessageIndex !== -1) {
        // Update the system message with current translations
        const updatedMessages = [...prev];
        updatedMessages[systemMessageIndex] = {
          id: '1',
          sender: t('gameRoom.system'),
          text: t('gameRoom.welcomeMessage'),
          timestamp: prev[systemMessageIndex].timestamp,
          isOwn: false,
        };
        return updatedMessages;
      } else if (prev.length === 0) {
        // If no messages, add the system message
        return [
          {
            id: '1',
            sender: t('gameRoom.system'),
            text: t('gameRoom.welcomeMessage'),
            timestamp: new Date(),
            isOwn: false,
          },
        ];
      }
      return prev;
    });
  }, [t]);
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [isWaiting, setIsWaiting] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [canMove, setCanMove] = useState(false); // Track if moves are allowed (2 players present)
  const [userId, setUserId] = useState<string>(propUserId || '');
  const [localRoomId, setLocalRoomId] = useState<string>(roomId || '');
  const [isInitializing, setIsInitializing] = useState(true); // Track if component is initializing
  const [username, setUsername] = useState<string>(localStorage.getItem('displayUsername') || localStorage.getItem('username') || '');
  const gameStateRef = useRef<any>(null); // Ref to track gameState for event handlers
  const listenersSetupRef = useRef<boolean>(false); // Track if listeners are already set up
  const currentRoomIdRef = useRef<string>(''); // Track current room to prevent duplicate setup
  const processedGameStartRef = useRef<Set<string>>(new Set()); // Track processed game_start events to prevent duplicates
  // Use refs for callback functions to prevent unnecessary re-renders
  const showNotificationRef = useRef(showNotification);
  const onNavigateRef = useRef(onNavigate);
  const onExitRoomRef = useRef(onExitRoom);
  
  // Update refs when callbacks change (but don't trigger re-renders)
  useEffect(() => {
    showNotificationRef.current = showNotification;
    onNavigateRef.current = onNavigate;
    onExitRoomRef.current = onExitRoom;
  }, [showNotification, onNavigate, onExitRoom]);

  // Determine player team and turn
  const getPlayerTeam = (): string => {
    if (!players.length || !userId) return '';
    const currentPlayerIndex = players.findIndex((p: any) => p.id === userId);
    if (currentPlayerIndex === -1) return '';

    if (gameType === 'tic-tac-toe') {
      return currentPlayerIndex === 0 ? 'X' : 'O';
    } else if (gameType === 'checkers') {
      return currentPlayerIndex === 0 ? 'player1' : 'player2';
    } else if (gameType === 'chess') {
      return currentPlayerIndex === 0 ? 'w' : 'b';
    }
    return '';
  };

  const getIsMyTurn = useCallback((): boolean => {
    // Can't move if less than 2 players
    if (!canMove || players.length < 2) {
      return false;
    }
    
    if (!gameState || !userId) {
      return false;
    }
    const playerTeam = getPlayerTeam();
    if (!playerTeam) {
      return false;
    }
    
    let isMyTurn = false;
    if (gameType === 'tic-tac-toe') {
      isMyTurn = gameState.currentPlayer === playerTeam;
    } else if (gameType === 'checkers') {
      isMyTurn = gameState.currentPlayer === playerTeam;
    } else if (gameType === 'chess') {
      isMyTurn = gameState.currentTeam === playerTeam;
    }
    
    return isMyTurn;
  }, [canMove, players.length, gameState, userId, gameType]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      console.error('Socket not available in GameRoom');
      return;
    }

    const currentRoomId = roomId || localRoomId;
    
    // Prevent duplicate listener setup for the same room
    if (listenersSetupRef.current && currentRoomIdRef.current === currentRoomId && currentRoomId) {
      console.log('Listeners already set up for room:', currentRoomId);
      return;
    }

    console.log('GameRoom useEffect - roomId:', roomId, 'gameType:', gameType, 'gameState:', gameState);
    
    // Mark listeners as set up
    listenersSetupRef.current = true;
    currentRoomIdRef.current = currentRoomId;
    
    // Initialize gameStateRef from current gameState
    gameStateRef.current = gameState;

    // Listen for socket errors
    const handleError = (error: any) => {
      console.error('Socket error:', error);
      if (error.message) {
        // Remove any existing prefixes (Error:, Move failed:) to avoid duplicates
        let message = error.message.replace(/^(Error:|Move failed:)\s*/i, '');
        
        // Use translation if translation key is provided
        if (error.translationKey) {
          try {
            if (error.translationData) {
              message = t(error.translationKey, error.translationData);
            } else {
              message = t(error.translationKey);
            }
          } catch (e) {
            // Fallback to original message if translation fails
            console.warn('Translation failed for key:', error.translationKey);
          }
        }
        
        showNotificationRef.current(message, 'error');
      }
    };
    
    socket.on('error', handleError);

    // Get userId from socket connected event or prop
    const handleConnected = (data: { userId: string; username: string }) => {
      console.log('GameRoom: User connected:', data);
      setUserId(data.userId);
      if (data.username) {
        setUsername(data.username);
        // Store display_username (second username) in localStorage
        localStorage.setItem('displayUsername', data.username);
      }
    };
    
    socket.on('connected', handleConnected);
    
    // Use prop userId if available
    if (propUserId && !userId) {
      setUserId(propUserId);
    }
    
    // Initialize localRoomId from prop if available
    if (roomId && !localRoomId) {
      setLocalRoomId(roomId);
    }

    // Request current game state if we have a roomId but no gameState
    // This handles the case where user navigates to room after game_start was already sent
    if ((roomId || localRoomId) && !gameState && socket.connected) {
      console.log('Requesting game state for room:', roomId || localRoomId);
      socket.emit('request_game_state');
    }

    // Listen for game start
    const handleGameStart = (data: any) => {
      console.log('✅ Game started event received:', data);
      console.log('Current roomId prop:', roomId, 'localRoomId:', localRoomId, 'Event roomId:', data.roomId);
      
      // Create a unique key for this event to prevent duplicate processing
      const eventSignature = `${data.roomId}-${JSON.stringify(data.gameState)}-${data.players?.map((p: any) => p.id).join(',')}`;
      
      // Check if we've already processed this exact event (within last 2 seconds)
      const now = Date.now();
      const recentEvents = Array.from(processedGameStartRef.current).filter(
        key => {
          const parts = key.split('|');
          const timestamp = parseInt(parts[1] || '0');
          return now - timestamp < 2000;
        }
      );
      processedGameStartRef.current = new Set(recentEvents);
      
      // Check if this exact event was already processed
      const eventKey = `${eventSignature}|${now}`;
      const signatureOnly = eventSignature;
      const alreadyProcessed = Array.from(processedGameStartRef.current).some(
        key => key.startsWith(signatureOnly + '|')
      );
      
      if (alreadyProcessed) {
        console.log('⚠️ Ignoring duplicate game_start event');
        return;
      }
      
      // Accept the event if:
      // 1. roomId matches (exact match)
      // 2. localRoomId matches (if prop wasn't set)
      // 3. Neither is set yet (first time receiving - accept any)
      // 4. This is a rematch scenario where we're moving to a new room
      const currentRoomId = roomId || localRoomId;
      const shouldAccept = !currentRoomId || data.roomId === currentRoomId || data.roomId === roomId || (data.roomId && !currentRoomId);
      
      if (shouldAccept) {
        // Mark as processed
        processedGameStartRef.current.add(eventKey);
        
        console.log('✅ Accepting game_start - Setting game state and players');
        // Update localRoomId if not set (but don't trigger re-render if it's the same)
        if (data.roomId && data.roomId !== localRoomId) {
          console.log('Setting localRoomId to:', data.roomId);
          setLocalRoomId(data.roomId);
        }
        // IMPORTANT: Set game state and waiting state FIRST to prevent race conditions
        if (data.gameState) {
          gameStateRef.current = data.gameState; // Update ref immediately
          setGameState(data.gameState);
          console.log('✅ Game state set:', data.gameState);
        }
        if (data.players) {
          setPlayers(data.players);
          console.log('✅ Players set:', data.players);
        }
        // Set canMove based on whether 2 players are present
        const playerCount = data.players?.length || 0;
        const movesAllowed = data.canMove !== undefined ? data.canMove : playerCount >= 2;
        setCanMove(movesAllowed);
        setIsWaiting(playerCount < 2); // Set waiting only if less than 2 players
        setGameOver(false);
        setIsInitializing(false); // Component initialized
        console.log('✅ Game started - canMove:', movesAllowed, 'players:', playerCount);
      } else {
        console.log('❌ Ignoring game_start - roomId mismatch. Current:', currentRoomId, 'Event:', data.roomId);
      }
    };

    // Listen for waiting for player
    const handleWaiting = (data: any) => {
      console.log('⏳ Waiting for player event received:', data);
      console.log('Current roomId:', roomId, 'localRoomId:', localRoomId, 'Event roomId:', data.roomId);
      // Accept if roomId matches OR if roomId is not set yet
      const currentRoomId = roomId || localRoomId;
      if (!currentRoomId || data.roomId === currentRoomId || data.roomId === roomId) {
        const playerCount = data.players?.length || 0;
        
        // Update players first
        if (data.players && Array.isArray(data.players)) {
          setPlayers(data.players);
        }
        
        // Update game state if provided (important when player leaves and room resets)
        if (data.gameState) {
          gameStateRef.current = data.gameState;
          setGameState(data.gameState);
          console.log('Updated game state in waiting_for_player:', data.gameState);
        }
        
        // Update local roomId if not set
        if (data.roomId && !localRoomId) {
          setLocalRoomId(data.roomId);
        }
        
        // Update canMove based on event data or player count
        const movesAllowed = data.canMove !== undefined ? data.canMove : playerCount >= 2;
        setCanMove(movesAllowed);
        
        // CRITICAL: If we have 2 players, NEVER set waiting to true
        // Game should start immediately, so hide waiting notification
        if (playerCount >= 2) {
          console.log('2 players present - setting isWaiting to false immediately');
          setIsWaiting(false);
          setCanMove(true);
          setIsInitializing(false);
          return; // Don't process further
        }
        
        // Only set waiting if we have less than 2 players
        if (playerCount < 2) {
          console.log('Setting waiting state (players:', playerCount, ')');
          setIsWaiting(true);
          setCanMove(false);
          setIsInitializing(false); // Component initialized
        } else {
          console.log('Ignoring waiting_for_player - game already started');
          setIsInitializing(false); // Component initialized
        }
      }
    };

    // Listen for move updates
    const handleMoveUpdate = (data: any) => {
      console.log('Move update:', data);
      if (data.gameState) {
        gameStateRef.current = data.gameState; // Update ref immediately
        setGameState(data.gameState);
        setIsWaiting(false);
        setCanMove(true); // Moves are allowed when receiving move updates (2 players present)
        setIsInitializing(false); // Component initialized
        console.log('✅ Game state updated after move:', data.gameState);
      }
    };

    // Listen for game over
    const handleGameOver = (data: any) => {
      console.log('Game over:', data);
      setGameOver(true);
      setGameState(data.gameState);
      
      // Show notification about game result
      if (data.isDraw) {
        showNotificationRef.current(t('notifications.gameEndedDraw'), 'info');
      } else if (data.winner || data.winningTeam) {
        const winnerTeam = data.winner || data.winningTeam;
        const playerTeam = getPlayerTeam();
        if (winnerTeam === playerTeam) {
          showNotificationRef.current(t('notifications.congratulations'), 'success');
        } else {
          // Find opponent username (the one who is not the current user)
          const opponent = players.find((p: any) => p.id !== userId);
          const opponentUsername = opponent?.username || t('common.opponent');
          showNotificationRef.current(t('notifications.opponentWonGame', { username: opponentUsername }), 'info');
        }
      }
    };

    // Listen for new match (rematch)
    const handleNewMatch = (data: any) => {
      console.log('New match started:', data);
      const currentRoomId = roomId || localRoomId;
      if (!currentRoomId || data.roomId === currentRoomId || data.roomId === roomId) {
        setGameState(data.gameState);
        setGameOver(false);
        setIsWaiting(false);
      }
    };

    // Listen for chat history (when rejoining)
    const handleChatHistory = (data: any) => {
      console.log('Chat history received:', data);
      console.log('Current userId:', userId, 'propUserId:', propUserId);
      if (data.messages && Array.isArray(data.messages)) {
        const currentUserId = userId || propUserId;
        const historyMessages: Message[] = data.messages.map((msg: any) => ({
          id: msg.id || Date.now().toString(),
          sender: msg.username || t('common.unknown'),
          text: msg.message,
          timestamp: new Date(msg.timestamp || Date.now()),
          isOwn: msg.userId === currentUserId,
        }));
        // Replace messages with history (but keep system message if exists)
        const systemMessage = messages.find(msg => msg.id === '1');
        setMessages(systemMessage ? [systemMessage, ...historyMessages] : historyMessages);
        console.log('Loaded chat history:', historyMessages.length, 'messages');
      }
    };

    // Listen for chat messages
    const handleChatMessage = (data: any) => {
      console.log('Chat message received:', data);
      // Check if this message is from the current user (already added locally)
      const isOwnMessage = data.userId === userId;
      
      // Only add if it's not our own message (we already added it locally)
      if (!isOwnMessage) {
        const newMessage: Message = {
          id: data.id || Date.now().toString(),
          sender: data.username || t('common.unknown'),
          text: data.message,
          timestamp: new Date(data.timestamp || Date.now()),
          isOwn: false,
        };
        setMessages((prev) => {
          // Check if message already exists (prevent duplicates)
          const exists = prev.some(msg => msg.id === data.id);
          if (exists) return prev;
          return [...prev, newMessage];
        });
      }
    };

    // Listen for player left
    const handlePlayerLeft = (data: any) => {
      console.log('Player left event received:', data);
      const currentRoomId = roomId || localRoomId;
      
      // Only process if roomId matches
      if (data.roomId && data.roomId !== currentRoomId) {
        console.log('Ignoring player_left - roomId mismatch');
        return;
      }

      // Update players list if provided
      if (data.players && Array.isArray(data.players)) {
        setPlayers(data.players);
        console.log('Updated players list after player left:', data.players);
      }

      // Find opponent username who left
      const leftPlayer = players.find((p: any) => p.id === data.userId);
      const opponentUsername = leftPlayer?.username || t('common.opponent');
      showNotificationRef.current(t('notifications.playerLeft', { username: opponentUsername }), 'info');
      
      // Set waiting state - moves disabled until new player joins
      setIsWaiting(true);
      setCanMove(false);
      
      // Note: waiting_for_player event will be sent after this with full state
    };

    // Listen for player joined (when someone joins your waiting room)
    const handlePlayerJoined = (data: any) => {
      console.log('Player joined:', data);
      console.log('Current roomId:', roomId, 'localRoomId:', localRoomId, 'Event roomId:', data.roomId);
      // Accept if roomId matches OR if roomId is not set yet
      const currentRoomId = roomId || localRoomId;
      if (!currentRoomId || data.roomId === currentRoomId || data.roomId === roomId) {
        const playerCount = data.players?.length || 0;
        setPlayers(data.players || []);
        
        // Update local roomId if not set
        if (data.roomId && !localRoomId) {
          setLocalRoomId(data.roomId);
        }
        
        // CRITICAL: If we now have 2 players, enable moves and hide waiting notification
        if (playerCount >= 2) {
          console.log('Two players in room, enabling moves and setting isWaiting to false');
          setCanMove(true);
          setIsWaiting(false);
          setIsInitializing(false); // Component initialized
        }
      }
    };

    // Listen for account banned
    const handleAccountBanned = (data: { message: string }) => {
      showNotificationRef.current(data.message || t('notifications.accountBanned'), 'error');
      // Redirect to login after a delay
      setTimeout(() => {
        onExitRoomRef.current();
        onNavigateRef.current('login');
      }, 3000);
    };

    // Listen for rematch that resulted in new room (when opponent left)
    const handleRematchNewRoom = (data: { oldRoomId: string; newRoomId: string; players: any[]; gameType: string }) => {
      console.log('Rematch created new room:', data);
      // Update roomId to the new room - this is critical for accepting subsequent events
      if (data.newRoomId) {
        setLocalRoomId(data.newRoomId);
        currentRoomIdRef.current = data.newRoomId;
        // Also update the ref used for event filtering
        listenersSetupRef.current = false; // Allow re-setup for new room
      }
      // Update players list to only show current players (remove old opponent)
      if (data.players) {
        setPlayers(data.players);
        console.log('✅ Updated players list after rematch:', data.players);
      }
      // Reset game state - will be set when game_start event arrives
      setGameState(null);
      gameStateRef.current = null;
      setIsWaiting(data.players.length < 2);
      setCanMove(data.players.length >= 2);
      setGameOver(false);
      setIsInitializing(false);
    };

    socket.on('game_start', handleGameStart);
    socket.on('waiting_for_player', handleWaiting);
    socket.on('player_joined', handlePlayerJoined);
    socket.on('move_update', handleMoveUpdate);
    socket.on('game_over', handleGameOver);
    socket.on('new_match_start', handleNewMatch);
    socket.on('chat_history', handleChatHistory);
    socket.on('chat_message', handleChatMessage);
    socket.on('player_left', handlePlayerLeft);
    socket.on('account_banned', handleAccountBanned);
    socket.on('rematch_new_room', handleRematchNewRoom);

    // Set a timeout to ensure we show something even if socket events don't arrive
    // Only set timeout if we don't have game state yet
    const initTimeout = setTimeout(() => {
      if (isInitializing && !gameState) {
        console.log('Initialization timeout - setting isInitializing to false');
        setIsInitializing(false);
      }
    }, 3000); // Reduced to 3 seconds since we have better event handling

    return () => {
      clearTimeout(initTimeout);
      listenersSetupRef.current = false;
      currentRoomIdRef.current = '';
      socket.off('game_start', handleGameStart);
      socket.off('waiting_for_player', handleWaiting);
      socket.off('player_joined', handlePlayerJoined);
      socket.off('move_update', handleMoveUpdate);
      socket.off('game_over', handleGameOver);
      socket.off('new_match_start', handleNewMatch);
      socket.off('chat_history', handleChatHistory);
      socket.off('chat_message', handleChatMessage);
      socket.off('player_left', handlePlayerLeft);
      socket.off('account_banned', handleAccountBanned);
      socket.off('rematch_new_room', handleRematchNewRoom);
      socket.off('connected', handleConnected);
      socket.off('error', handleError);
    };
  }, [roomId, localRoomId, userId, gameType, isConnected, propUserId]); // Removed function dependencies to prevent unnecessary re-renders

  const handleSendMessage = (text: string) => {
    console.log('Sending chat message:', text);
    // Generate a temporary ID that we'll match when the server responds
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const newMessage: Message = {
      id: tempId,
      sender: t('common.you'),
      text,
      timestamp: new Date(),
      isOwn: true,
    };
    setMessages((prev) => [...prev, newMessage]);
    onSendMessage(text);
  };

  // Show loading state if we don't have gameState and we're not explicitly waiting
  const showLoading = (isInitializing || (!gameState && !isWaiting)) && (roomId || localRoomId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex flex-col">
      <Header isConnected={isConnected} username={username} onLogout={onLogout} userId={userId} onNavigate={onNavigate} />

      <main className="flex-1 max-w-7xl mx-auto px-2 sm:px-3 md:px-4 lg:px-6 xl:px-8 py-1 sm:py-2 md:py-3 lg:py-4 xl:py-6">
        {isWaiting && players.length > 0 && players.length < 2 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg sm:rounded-xl p-1.5 sm:p-2 mb-1 sm:mb-2 text-center">
            <p className="text-yellow-800 font-semibold text-[11px] sm:text-xs">
              {t('game.waitingForAnotherPlayer')}
            </p>
            <p className="text-yellow-600 text-[10px] sm:text-xs mt-0.5">
              {t('game.playersInRoom', { count: players.length })}
            </p>
          </div>
        )}
        {showLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg sm:rounded-xl p-1.5 sm:p-2 mb-1 sm:mb-2 text-center">
            <p className="text-blue-800 font-semibold text-[11px] sm:text-xs">
              {t('game.connectingToRoom')}
            </p>
            <p className="text-blue-600 text-[10px] sm:text-xs mt-0.5">
              {t('game.pleaseWait')}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-1.5 sm:gap-2 md:gap-3 lg:gap-4 xl:gap-6">
          {/* Game Board Section */}
          <div className="lg:col-span-2 space-y-1.5 sm:space-y-2">
            {gameState ? (
              <div>
                <GameBoard
                  key={`board-${roomId || localRoomId}`}
                  gameType={gameType}
                  gameState={gameState}
                  playerTeam={getPlayerTeam()}
                  isMyTurn={getIsMyTurn()}
                  players={players}
                  currentUserId={userId}
                />
              </div>
            ) : isWaiting ? (
              <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-2 sm:p-3 flex items-center justify-center h-[calc(50vh-100px)] sm:h-[calc(50vh-110px)] md:h-[calc(50vh-120px)] lg:h-[min(700px,calc(100vh-200px))] min-h-[180px] sm:min-h-[200px] md:min-h-[220px] lg:min-h-[400px]">
                <div className="text-center px-1 sm:px-2 md:px-4">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 xl:w-56 xl:h-56 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg sm:rounded-xl border-2 border-blue-200 flex items-center justify-center mb-1.5 sm:mb-2 md:mb-3 mx-auto">
                    <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl">
                      {gameType === 'tic-tac-toe' ? '⭕' : gameType === 'checkers' ? '⚫' : '♟️'}
                    </span>
                  </div>
                  <p className="text-gray-600 font-medium text-[11px] sm:text-xs md:text-sm">
                    {gameType === 'tic-tac-toe' && t('game.board.ticTacToeBoard')}
                    {gameType === 'checkers' && t('game.board.checkersBoard')}
                    {gameType === 'chess' && t('game.board.chessBoard')}
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{t('game.board.waitingForGameStart')}</p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-2 sm:p-3 flex items-center justify-center h-[calc(50vh-100px)] sm:h-[calc(50vh-110px)] md:h-[calc(50vh-120px)] lg:h-[min(700px,calc(100vh-200px))] min-h-[180px] sm:min-h-[200px] md:min-h-[220px] lg:min-h-[400px]">
                <div className="text-center">
                  <div className="inline-block w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-8 lg:h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-1.5 sm:mb-2 md:mb-3" />
                  <p className="text-gray-600 text-[11px] sm:text-xs md:text-sm">{t('game.loadingGame')}</p>
                  {!isConnected && (
                    <p className="text-[10px] sm:text-xs text-red-600 mt-0.5 sm:mt-1">{t('game.notConnectedToServer')}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-1 sm:gap-1.5">
              <button
                onClick={onRematch}
                className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-1.5 sm:py-2 md:py-2.5 rounded-lg sm:rounded-xl font-semibold active:from-blue-700 active:to-cyan-600 sm:hover:from-blue-700 sm:hover:to-cyan-600 transition-all duration-300 flex items-center justify-center gap-1 sm:gap-1.5 shadow-lg active:shadow-xl sm:hover:shadow-xl touch-manipulation min-h-[36px] sm:min-h-[40px] md:min-h-[44px] text-[11px] sm:text-xs md:text-sm"
              >
                <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
                {t('game.rematch')}
              </button>
              <button
                onClick={onExitRoom}
                className="flex-1 bg-gray-200 text-gray-900 py-1.5 sm:py-2 md:py-2.5 rounded-lg sm:rounded-xl font-semibold active:bg-gray-300 sm:hover:bg-gray-300 transition-colors flex items-center justify-center gap-1 sm:gap-1.5 touch-manipulation min-h-[36px] sm:min-h-[40px] md:min-h-[44px] text-[11px] sm:text-xs md:text-sm"
              >
                <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
                {t('game.exitRoom')}
              </button>
            </div>
          </div>

          {/* Right Column: Video Chat and Chat */}
          <div className="lg:col-span-3 space-y-1.5 sm:space-y-2 md:space-y-3 lg:space-y-4 flex flex-col">
            {players.length === 0 && (
              <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-2 sm:p-3">
                <div className="text-center text-gray-500 text-[11px] sm:text-xs md:text-sm">
                  <p>{t('game.waitingForPlayers')}</p>
                </div>
              </div>
            )}
            
            {/* Video Chat - First on mobile */}
            <div className="">
              <VideoPanel 
                onStartVideo={onStartVideo} 
                players={players} 
                currentUserId={userId}
                roomId={roomId || localRoomId}
              />
            </div>

            {/* Chat - Below Video Chat on mobile */}
            <div className="h-[calc(25vh-50px)] sm:h-[calc(25vh-55px)] md:h-[calc(25vh-60px)] lg:h-[400px] xl:h-[450px] min-h-[100px] sm:min-h-[110px] md:min-h-[120px] lg:min-h-[350px] xl:min-h-[400px] flex-shrink-0">
              <ChatPanel onSendMessage={handleSendMessage} messages={messages} />
            </div>

            {/* Game Info Panel - Visible on all screen sizes */}
            {players.length > 0 && (
              <div className="flex-shrink-0">
                <GameInfoPanel
                  gameType={gameType}
                  players={players}
                  gameState={gameState}
                  playerTeam={getPlayerTeam()}
                  isMyTurn={getIsMyTurn()}
                  gameOver={gameOver}
                  currentUserId={userId}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
