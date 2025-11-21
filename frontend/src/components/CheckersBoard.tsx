import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { emitMove } from '../utils/socket';

interface CheckersBoardProps {
  gameState: {
    boardState: (string | null)[][];
    currentPlayer: string;
    activePiece: { x: number; y: number } | null;
    winner: string | null;
  };
  playerTeam: string;
  isMyTurn: boolean;
  players?: Array<{ id: string; username: string }>;
  currentUserId?: string;
}

export default function CheckersBoard({ gameState, playerTeam, isMyTurn, players, currentUserId }: CheckersBoardProps) {
  const { t } = useTranslation();
  const [selectedPiece, setSelectedPiece] = useState<{ x: number; y: number } | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    setSelectedPiece(null);
    setPossibleMoves([]);
  }, [gameState.currentPlayer]);

  const handleSquareClick = (x: number, y: number) => {
    if (!isMyTurn || gameState.winner) return;

    const piece = gameState.boardState[y][x];

    // If clicking on own piece, select it
    if (piece === playerTeam) {
      setSelectedPiece({ x, y });
      calculatePossibleMoves(x, y);
      return;
    }

    // If a piece is selected and clicking on empty square or opponent piece, try to move
    if (selectedPiece) {
      const move = { from: selectedPiece, to: { x, y } };
      emitMove('checkers', move);
      setSelectedPiece(null);
      setPossibleMoves([]);
    }
  };

  const calculatePossibleMoves = (x: number, y: number) => {
    const moves: Array<{ x: number; y: number }> = [];
    // player1 is at bottom (rows 5-7) and moves up (decreasing y, so dy is negative)
    // player2 is at top (rows 0-2) and moves down (increasing y, so dy is positive)
    const directions = playerTeam === 'player1' 
      ? [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }]  // Move up (decrease y)
      : [{ dx: -1, dy: 1 }, { dx: 1, dy: 1 }];   // Move down (increase y)

    directions.forEach(({ dx, dy }) => {
      const newX = x + dx;
      const newY = y + dy;

      // Check if within bounds
      if (newX >= 0 && newX < 8 && newY >= 0 && newY < 8) {
        // Can move to empty square
        if (gameState.boardState[newY][newX] === null) {
          moves.push({ x: newX, y: newY });
        }
        // Can jump over opponent piece
        else if (gameState.boardState[newY][newX] !== playerTeam) {
          const jumpX = newX + dx;
          const jumpY = newY + dy;
          if (jumpX >= 0 && jumpX < 8 && jumpY >= 0 && jumpY < 8 && gameState.boardState[jumpY][jumpX] === null) {
            moves.push({ x: jumpX, y: jumpY });
          }
        }
      }
    });

    setPossibleMoves(moves);
  };

  const isSquareHighlighted = (x: number, y: number) => {
    return possibleMoves.some(move => move.x === x && move.y === y);
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
    if (isMyTurn) {
      return t('game.yourTurn');
    }
    return t('game.opponentTurn', { username: opponentUsername });
  };

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="mb-4 text-center">
        <p className="text-xl font-semibold text-gray-800">{getStatusMessage()}</p>
        <p className="text-sm text-gray-600 mt-1">{t('game.youAre')} {playerTeam === 'player1' ? t('game.player1Bottom') : t('game.player2Top')}</p>
      </div>
      <div className="grid grid-cols-8 gap-0 overflow-hidden shadow-2xl">
        {Array.from({ length: 64 }).map((_, index) => {
          const x = index % 8;
          const y = Math.floor(index / 8);
          const isLight = (x + y) % 2 === 0;
          const piece = gameState.boardState[y][x];
          const isSelected = selectedPiece?.x === x && selectedPiece?.y === y;
          const isHighlighted = isSquareHighlighted(x, y);

          return (
            <button
              key={`${x}-${y}`}
              onClick={() => handleSquareClick(x, y)}
              disabled={!isMyTurn || gameState.winner !== null}
              className={`
                w-16 h-16 flex items-center justify-center
                ${isLight ? 'bg-amber-100' : 'bg-amber-800'}
                ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2' : ''}
                ${isHighlighted ? 'bg-green-400' : ''}
                ${piece ? 'cursor-pointer' : ''}
                transition-all duration-150
                ${isMyTurn && !gameState.winner ? 'hover:opacity-80' : ''}
              `}
            >
              {piece && (
                <div
                  className={`
                    w-12 h-12 rounded-full border-4
                    ${piece === 'player1' 
                      ? 'bg-red-500 border-red-700' 
                      : 'bg-blue-500 border-blue-700'
                    }
                    shadow-lg
                  `}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

