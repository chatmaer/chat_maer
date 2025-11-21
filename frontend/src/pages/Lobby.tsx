import { Users, Circle, Square, Crown, ArrowLeft } from 'lucide-react';
import Header from '../components/Header';

interface Room {
  id: string;
  gameType: 'tic-tac-toe' | 'checkers' | 'chess';
  players: number;
  maxPlayers: number;
  keyword?: string;
}

interface LobbyProps {
  onNavigate: (page: string, data?: { gameType?: string; roomId?: string }) => void;
  isConnected: boolean;
  userId?: string;
}

export default function Lobby({ onNavigate, isConnected, userId }: LobbyProps) {
  const activeRooms: Room[] = [
    {
      id: '1',
      gameType: 'tic-tac-toe',
      players: 1,
      maxPlayers: 2,
      keyword: 'quick-game',
    },
    {
      id: '2',
      gameType: 'chess',
      players: 1,
      maxPlayers: 2,
      keyword: 'master-chess',
    },
    {
      id: '3',
      gameType: 'checkers',
      players: 1,
      maxPlayers: 2,
    },
  ];

  const getGameIcon = (gameType: string) => {
    switch (gameType) {
      case 'tic-tac-toe':
        return Circle;
      case 'checkers':
        return Square;
      case 'chess':
        return Crown;
      default:
        return Circle;
    }
  };

  const getGameColor = (gameType: string) => {
    switch (gameType) {
      case 'tic-tac-toe':
        return 'from-blue-500 to-cyan-500';
      case 'checkers':
        return 'from-red-500 to-orange-500';
      case 'chess':
        return 'from-purple-500 to-pink-500';
      default:
        return 'from-blue-500 to-cyan-500';
    }
  };

  const handleJoinRoom = (room: Room) => {
    onNavigate('game-room', { gameType: room.gameType, roomId: room.id });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <Header isConnected={isConnected} username={localStorage.getItem('displayUsername') || localStorage.getItem('username') || undefined} userId={userId} onNavigate={onNavigate} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Home
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 mb-2">Active Rooms</h2>
              <p className="text-gray-600">Join an existing game or create your own</p>
            </div>
            <div className="bg-white px-6 py-3 rounded-xl shadow-lg">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-gray-900">
                  {activeRooms.length} rooms active
                </span>
              </div>
            </div>
          </div>
        </div>

        {activeRooms.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-gray-900 mb-2">No Active Rooms</h3>
            <p className="text-gray-600 mb-6">
              Be the first to create a game room!
            </p>
            <button
              onClick={() => onNavigate('home')}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300"
            >
              Create Room
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeRooms.map((room) => {
              const Icon = getGameIcon(room.gameType);
              const isFull = room.players >= room.maxPlayers;

              return (
                <div
                  key={room.id}
                  className="bg-white rounded-2xl shadow-lg p-6 hover:shadow-xl transition-all duration-300"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`w-12 h-12 bg-gradient-to-br ${getGameColor(
                        room.gameType
                      )} rounded-xl flex items-center justify-center`}
                    >
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        isFull
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {isFull ? 'Full' : 'Open'}
                    </div>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 mb-2 capitalize">
                    {room.gameType.replace('-', ' ')}
                  </h3>

                  {room.keyword && (
                    <div className="mb-3 px-3 py-1 bg-gray-100 rounded-lg inline-block">
                      <span className="text-xs text-gray-600">
                        Keyword: <span className="font-semibold">{room.keyword}</span>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {room.players}/{room.maxPlayers} players
                    </span>
                  </div>

                  <button
                    onClick={() => handleJoinRoom(room)}
                    disabled={isFull}
                    className={`w-full py-2 rounded-xl font-semibold transition-all duration-300 ${
                      isFull
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-700 hover:to-cyan-600 shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {isFull ? 'Room Full' : 'Join Room'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
