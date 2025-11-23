import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { emitMove, getSocket, emitPawnPromotion } from '../utils/socket';

// Import chess piece images
import pawn_w from '../assets/pawn_w.webp';
import pawn_b from '../assets/pawn_b.webp';
import rook_w from '../assets/rook_w.webp';
import rook_b from '../assets/rook_b.webp';
import knight_w from '../assets/knight_w.webp';
import knight_b from '../assets/knight_b.webp';
import bishop_w from '../assets/bishop_w.webp';
import bishop_b from '../assets/bishop_b.webp';
import queen_w from '../assets/queen_w.webp';
import queen_b from '../assets/queen_b.webp';
import king_w from '../assets/king_w.webp';
import king_b from '../assets/king_b.webp';

interface ChessPiece {
  type: string;
  team: string;
  position: { x: number; y: number };
  hasMoved: boolean;
}

interface ChessBoardProps {
  gameState: {
    pieces: ChessPiece[];
    totalTurns: number;
    currentTeam: string;
    winningTeam: string | null;
    pendingPromotion?: { x: number; y: number; team: string } | null;
  };
  playerTeam: string;
  isMyTurn: boolean;
  players?: Array<{ id: string; username: string }>;
  currentUserId?: string;
}

const PIECE_IMAGES: Record<string, Record<string, string>> = {
  w: {
    pawn: pawn_w,
    rook: rook_w,
    knight: knight_w,
    bishop: bishop_w,
    queen: queen_w,
    king: king_w,
  },
  b: {
    pawn: pawn_b,
    rook: rook_b,
    knight: knight_b,
    bishop: bishop_b,
    queen: queen_b,
    king: king_b,
  },
};

export default function ChessBoard({ gameState, playerTeam, isMyTurn, players, currentUserId }: ChessBoardProps) {
  const { t } = useTranslation();
  const [selectedPiece, setSelectedPiece] = useState<ChessPiece | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<Array<{ x: number; y: number }>>([]);
  const [promotionPosition, setPromotionPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setSelectedPiece(null);
    setPossibleMoves([]);
  }, [gameState.currentTeam]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handlePromotionRequired = (data: { position: { x: number; y: number; team: string } }) => {
      if (data.position && data.position.team === playerTeam) {
        setPromotionPosition({ x: data.position.x, y: data.position.y });
      }
    };

    socket.on('pawn_promotion_required', handlePromotionRequired);

    return () => {
      socket.off('pawn_promotion_required', handlePromotionRequired);
    };
  }, [playerTeam]);

  useEffect(() => {
    // Check if there's a pending promotion in gameState
    if (gameState.pendingPromotion && gameState.pendingPromotion.team === playerTeam) {
      setPromotionPosition(gameState.pendingPromotion);
    }
  }, [gameState.pendingPromotion, playerTeam]);

  const getPieceAt = (x: number, y: number): ChessPiece | undefined => {
    return gameState.pieces.find(p => p.position.x === x && p.position.y === y);
  };

  const handleSquareClick = (x: number, y: number) => {
    if (!isMyTurn || gameState.winningTeam || promotionPosition) return;

    const piece = getPieceAt(x, y);

    // If clicking on own piece, select it
    if (piece && piece.team === playerTeam) {
      setSelectedPiece(piece);
      calculatePossibleMoves(piece);
      return;
    }

    // If a piece is selected and clicking on empty square or opponent piece, try to move
    if (selectedPiece) {
      const move = { from: selectedPiece.position, to: { x, y } };
      
      // Check if this is a pawn promotion move
      // Don't send promotionType - let the server detect it and request promotion
      const promotionRow = playerTeam === 'w' ? 7 : 0;
      if (selectedPiece.type === 'pawn' && y === promotionRow) {
        // Don't include promotionType - server will detect and request it
        // This allows the user to choose the promotion piece via modal
      }
      
      emitMove('chess', move);
      setSelectedPiece(null);
      setPossibleMoves([]);
    }
  };

  const handlePromotionChoice = (promotionType: string) => {
    if (promotionPosition) {
      emitPawnPromotion(promotionPosition, promotionType);
      setPromotionPosition(null);
    }
  };

  const calculatePossibleMoves = (piece: ChessPiece) => {
    const moves: Array<{ x: number; y: number }> = [];
    const { type, position, team } = piece;

    // Simple move calculation (can be enhanced with full chess rules)
    switch (type) {
      case 'pawn':
        const direction = team === 'w' ? 1 : -1;
        // Forward move
        if (!getPieceAt(position.x, position.y + direction)) {
          moves.push({ x: position.x, y: position.y + direction });
          // Double move from starting position
          if (!piece.hasMoved && !getPieceAt(position.x, position.y + 2 * direction)) {
            moves.push({ x: position.x, y: position.y + 2 * direction });
          }
        }
        // Capture diagonally
        [-1, 1].forEach(dx => {
          const target = getPieceAt(position.x + dx, position.y + direction);
          if (target && target.team !== team) {
            moves.push({ x: position.x + dx, y: position.y + direction });
          }
        });
        break;

      case 'rook':
        // Horizontal and vertical moves
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          for (let i = 1; i < 8; i++) {
            const newX = position.x + dx * i;
            const newY = position.y + dy * i;
            if (newX < 0 || newX >= 8 || newY < 0 || newY >= 8) break;
            const target = getPieceAt(newX, newY);
            if (!target) {
              moves.push({ x: newX, y: newY });
            } else {
              if (target.team !== team) moves.push({ x: newX, y: newY });
              break;
            }
          }
        });
        break;

      case 'bishop':
        // Diagonal moves
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
          for (let i = 1; i < 8; i++) {
            const newX = position.x + dx * i;
            const newY = position.y + dy * i;
            if (newX < 0 || newX >= 8 || newY < 0 || newY >= 8) break;
            const target = getPieceAt(newX, newY);
            if (!target) {
              moves.push({ x: newX, y: newY });
            } else {
              if (target.team !== team) moves.push({ x: newX, y: newY });
              break;
            }
          }
        });
        break;

      case 'queen':
        // Combines rook and bishop moves
        [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
          for (let i = 1; i < 8; i++) {
            const newX = position.x + dx * i;
            const newY = position.y + dy * i;
            if (newX < 0 || newX >= 8 || newY < 0 || newY >= 8) break;
            const target = getPieceAt(newX, newY);
            if (!target) {
              moves.push({ x: newX, y: newY });
            } else {
              if (target.team !== team) moves.push({ x: newX, y: newY });
              break;
            }
          }
        });
        break;

      case 'king':
        // One square in any direction
        [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dx, dy]) => {
          const newX = position.x + dx;
          const newY = position.y + dy;
          if (newX >= 0 && newX < 8 && newY >= 0 && newY < 8) {
            const target = getPieceAt(newX, newY);
            if (!target || target.team !== team) {
              moves.push({ x: newX, y: newY });
            }
          }
        });
        break;

      case 'knight':
        // L-shaped moves
        [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dx, dy]) => {
          const newX = position.x + dx;
          const newY = position.y + dy;
          if (newX >= 0 && newX < 8 && newY >= 0 && newY < 8) {
            const target = getPieceAt(newX, newY);
            if (!target || target.team !== team) {
              moves.push({ x: newX, y: newY });
            }
          }
        });
        break;
    }

    setPossibleMoves(moves);
  };

  const isSquareHighlighted = (x: number, y: number) => {
    return possibleMoves.some(move => move.x === x && move.y === y);
  };

  const isSquareSelected = (x: number, y: number) => {
    return selectedPiece?.position.x === x && selectedPiece?.position.y === y;
  };

  const getOpponentUsername = () => {
    if (!currentUserId || !players || players.length < 2) return t('common.opponent');
    const opponent = players.find((p) => p.id !== currentUserId);
    return opponent?.username || t('common.opponent');
  };

  const getStatusMessage = () => {
    const opponentUsername = getOpponentUsername();
    if (gameState.winningTeam) {
      return `${t('game.winner')} ${gameState.winningTeam === playerTeam ? t('common.you') : opponentUsername}!`;
    }
    if (isMyTurn) {
      return t('game.yourTurn');
    }
    return t('game.opponentTurn', { username: opponentUsername });
  };

  const renderSquare = (x: number, y: number) => {
    const isLight = (x + y) % 2 === 0;
    const piece = getPieceAt(x, y);
    const isHighlighted = isSquareHighlighted(x, y);
    const isSelected = isSquareSelected(x, y);

    return (
      <button
        key={`${x}-${y}`}
        onClick={() => handleSquareClick(x, y)}
        disabled={!isMyTurn || gameState.winningTeam !== null || promotionPosition !== null}
        className={`
          aspect-square w-full flex items-center justify-center text-3xl
          ${isLight ? 'bg-amber-100' : 'bg-amber-800'}
          ${isSelected ? 'ring-2 sm:ring-4 ring-blue-500 ring-offset-1 sm:ring-offset-2' : ''}
          ${isHighlighted ? 'bg-green-400' : ''}
          transition-all duration-150
          ${piece && piece.team === playerTeam && isMyTurn ? 'cursor-pointer hover:opacity-80' : ''}
        `}
      >
        {piece && (
          <img 
            src={PIECE_IMAGES[piece.team]?.[piece.type]} 
            alt={`${piece.team} ${piece.type}`}
            className="w-[60%] h-[60%] sm:w-12 sm:h-12 object-contain"
          />
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 h-full">
      <div className="mb-3 text-center">
        <p className="text-lg sm:text-xl font-semibold text-gray-800">{getStatusMessage()}</p>
        <p className="text-xs sm:text-sm text-gray-600 mt-1">
          {t('game.youAre')} {playerTeam === 'w' ? t('game.whiteBottom') : t('game.blackTop')} | {t('game.turn')} {gameState.totalTurns}
        </p>
      </div>
      <div className="grid grid-cols-8 gap-0 overflow-hidden shadow-2xl w-full max-w-[512px] mx-auto">
        {Array.from({ length: 64 }).map((_, index) => {
          const x = index % 8;
          const y = Math.floor(index / 8);
          // Render board: y=0 (white pieces) at bottom, y=7 (black pieces) at top
          // So we render rows in reverse order
          const renderY = 7 - y;
          return renderSquare(x, renderY);
        })}
      </div>

      {/* Pawn Promotion Modal */}
      {promotionPosition && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-4 text-center">{t('game.promotion.promotePawn')}</h3>
            <p className="text-sm text-gray-600 mb-4 text-center">{t('game.promotion.choosePiece')}</p>
            <div className="grid grid-cols-4 gap-4">
              {['queen', 'rook', 'bishop', 'knight'].map((pieceType) => (
                <button
                  key={pieceType}
                  onClick={() => handlePromotionChoice(pieceType)}
                  className="w-20 h-20 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors border-2 border-transparent hover:border-blue-500"
                  title={pieceType.charAt(0).toUpperCase() + pieceType.slice(1)}
                >
                  <img 
                    src={PIECE_IMAGES[playerTeam]?.[pieceType]} 
                    alt={`${playerTeam} ${pieceType}`}
                    className="w-16 h-16 object-contain"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

