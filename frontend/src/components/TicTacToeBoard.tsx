import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { emitMove } from '../utils/socket';

interface TicTacToeBoardProps {
  gameState: {
    board: (string | null)[];
    currentPlayer: string;
    winner: string | null;
    isDraw: boolean;
  };
  playerTeam: string;
  isMyTurn: boolean;
  players?: Array<{ id: string; username: string }>;
  currentUserId?: string;
}

export default function TicTacToeBoard({ gameState, playerTeam, isMyTurn, players, currentUserId }: TicTacToeBoardProps) {
  const { t } = useTranslation();
  const [localBoard, setLocalBoard] = useState<(string | null)[]>(gameState.board);

  useEffect(() => {
    setLocalBoard(gameState.board);
  }, [gameState]);

  const handleSquareClick = (index: number) => {
    console.log('Square clicked:', index, 'isMyTurn:', isMyTurn, 'playerTeam:', playerTeam);
    if (!isMyTurn || gameState.winner || gameState.isDraw || localBoard[index] !== null) {
      console.log('Move blocked:', { isMyTurn, winner: gameState.winner, isDraw: gameState.isDraw, cellValue: localBoard[index] });
      return;
    }

    // Send move to server
    console.log('Sending move to server:', { index, gameType: 'tic_tac_toe' });
    emitMove('tic_tac_toe', { index });
  };

  const getSquareContent = (value: string | null) => {
    if (value === 'X') return '❌';
    if (value === 'O') return '⭕';
    return '';
  };

  const getOpponentUsername = () => {
    if (!currentUserId || !players || players.length < 2) return t('common.opponent');
    const opponent = players.find((p) => p.id !== currentUserId);
    return opponent?.username || t('common.opponent');
  };

  const getStatusMessage = () => {
    const opponentUsername = getOpponentUsername();
    if (gameState.winner) {
      return `${t('game.winner')} ${gameState.winner === playerTeam ? t('common.you') : opponentUsername}!`;
    }
    if (gameState.isDraw) {
      return t('game.gameOverDraw');
    }
    if (!isMyTurn && !gameState.winner && !gameState.isDraw) {
      // Check if it's because we're waiting for a player
      if (isMyTurn === false) {
        return t('game.opponentTurn', { username: opponentUsername });
      }
    }
    if (isMyTurn) {
      return t('game.yourTurn');
    }
    return t('game.opponentTurn', { username: opponentUsername });
  };

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="mb-4 text-center">
        <p className="text-xl font-semibold text-gray-800">{getStatusMessage()}</p>
        <p className="text-sm text-gray-600 mt-1">{t('game.youAre')} {playerTeam}</p>
      </div>
      <div className="grid grid-cols-3">
        {localBoard.map((value, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const isLastRow = row === 2;
          const isLastCol = col === 2;
          
          return (
            <button
              key={index}
              onClick={() => handleSquareClick(index)}
              disabled={!isMyTurn || value !== null || gameState.winner !== null || gameState.isDraw}
              className={`
                w-24 h-24 bg-white flex items-center justify-center text-4xl
                transition-all duration-200
                ${!isLastCol ? 'border-r border-black' : ''}
                ${!isLastRow ? 'border-b border-black' : ''}
                ${value === null && isMyTurn && !gameState.winner && !gameState.isDraw
                  ? 'hover:bg-gray-100 cursor-pointer active:scale-95'
                  : 'cursor-not-allowed opacity-60'
                }
                ${value !== null ? 'bg-blue-50' : ''}
              `}
            >
              {getSquareContent(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

