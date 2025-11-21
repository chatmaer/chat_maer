import { Users, Clock, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ReportUser from './ReportUser';

interface Player {
  id: string;
  username: string;
}

interface GameInfoPanelProps {
  gameType: 'tic-tac-toe' | 'checkers' | 'chess';
  players: Player[];
  gameState: any;
  playerTeam: string;
  isMyTurn: boolean;
  gameOver: boolean;
  currentUserId?: string;
}

export default function GameInfoPanel({
  gameType,
  players,
  gameState,
  playerTeam,
  isMyTurn,
  gameOver,
  currentUserId,
}: GameInfoPanelProps) {
  const { t } = useTranslation();
  const getGameName = () => {
    switch (gameType) {
      case 'tic-tac-toe':
        return t('game.ticTacToe');
      case 'checkers':
        return t('game.checkers');
      case 'chess':
        return t('game.chess');
      default:
        return t('game.game');
    }
  };

  const getPlayerDisplayName = (player: Player, index: number) => {
    if (gameType === 'tic-tac-toe') {
      return `${player.username} (${index === 0 ? 'X' : 'O'})`;
    } else if (gameType === 'checkers') {
      return `${player.username} (${index === 0 ? t('game.player1') : t('game.player2')})`;
    } else if (gameType === 'chess') {
      return `${player.username} (${index === 0 ? t('game.white') : t('game.black')})`;
    }
    return player.username;
  };

  const getOpponentUsername = () => {
    if (!currentUserId || players.length < 2) return t('common.opponent');
    const opponent = players.find((p) => p.id !== currentUserId);
    return opponent?.username || t('common.opponent');
  };

  const getGameStatus = () => {
    // Check if we have less than 2 players
    if (players.length < 2) {
      return t('game.waitingForPlayer');
    }
    if (!gameState) {
      return t('game.waitingForGameStart');
    }
    if (gameOver) {
      if (gameState?.winner || gameState?.winningTeam) {
        const winner = gameState.winner || gameState.winningTeam;
        const opponentUsername = getOpponentUsername();
        return `${t('game.gameOver')} - ${winner === playerTeam ? t('game.youWin') : t('game.opponentWins', { username: opponentUsername })}`;
      }
      if (gameState?.isDraw) {
        return t('game.gameOverDraw');
      }
      return t('game.gameOver');
    }
    if (isMyTurn) {
      return t('game.yourTurn');
    }
    const opponentUsername = getOpponentUsername();
    return t('game.opponentTurn', { username: opponentUsername });
  };

  const getCurrentPlayerInfo = () => {
    if (!gameState) return null;
    
    if (gameType === 'tic-tac-toe') {
      return `${t('game.currentPlayer')} ${gameState.currentPlayer}`;
    } else if (gameType === 'checkers') {
      return `${t('game.currentPlayer')} ${gameState.currentPlayer === 'player1' ? t('game.player1') : t('game.player2')}`;
    } else if (gameType === 'chess') {
      return `${t('game.currentTeam')} ${gameState.currentTeam === 'w' ? t('game.white') : t('game.black')}`;
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Trophy className="w-6 h-6 text-blue-600" />
        <h3 className="text-xl font-bold text-gray-900">{getGameName()}</h3>
      </div>

      {/* Game Status */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border-2 border-blue-200">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-5 h-5 text-blue-600" />
          <p className="font-semibold text-gray-800">{getGameStatus()}</p>
        </div>
        {gameState && getCurrentPlayerInfo() && (
          <p className="text-sm text-gray-600 mt-1">{getCurrentPlayerInfo()}</p>
        )}
        {gameType === 'chess' && gameState?.totalTurns && (
          <p className="text-xs text-gray-500 mt-1">{t('game.turn')} {gameState.totalTurns}</p>
        )}
        {players.length < 2 && (
          <p className="text-xs text-gray-500 mt-2 italic">
            {t('game.movesDisabled')}
          </p>
        )}
      </div>

      {/* Players */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-gray-600" />
          <h4 className="font-semibold text-gray-800">{t('game.players')}</h4>
        </div>
        <div className="space-y-3">
          {players.map((player, index) => {
            const isCurrentPlayer = playerTeam && (
              (gameType === 'tic-tac-toe' && playerTeam === (index === 0 ? 'X' : 'O')) ||
              (gameType === 'checkers' && playerTeam === (index === 0 ? 'player1' : 'player2')) ||
              (gameType === 'chess' && playerTeam === (index === 0 ? 'w' : 'b'))
            );
            
            return (
              <div
                key={player.id}
                className={`p-3 rounded-lg border-2 ${
                  isCurrentPlayer
                    ? 'bg-blue-50 border-blue-300'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-800">
                    {getPlayerDisplayName(player, index)}
                  </p>
                  <div className="flex items-center gap-2">
                    {isCurrentPlayer && (
                      <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded-full">
                        {t('common.you')}
                      </span>
                    )}
                    {!isCurrentPlayer && currentUserId && player.id !== currentUserId && (
                      <ReportUser
                        reportedUserId={player.id}
                        reportedUsername={player.username}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Game Info */}
      {gameState && (
        <div className="pt-4 border-t border-gray-200">
          <div className="text-xs text-gray-500 space-y-1">
            <p>{t('game.gameType')} {getGameName()}</p>
            {gameType === 'chess' && gameState?.totalTurns && (
              <p>{t('game.totalTurns')} {gameState.totalTurns}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

