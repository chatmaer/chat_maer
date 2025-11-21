import { CheckersGame } from "../games/checkers.js";
import { ChessGame } from "../games/chess.js";
import { TicTacToeGame } from "../games/ticTacToe.js";

export type GameType = "tic_tac_toe" | "checkers" | "chess";
export type GameInstance = TicTacToeGame | CheckersGame | ChessGame;

const activeGames = new Map<string, GameInstance>();

export const initializeGame = (gameType: GameType): GameInstance => {
  switch (gameType) {
    case "tic_tac_toe":
      return new TicTacToeGame();
    case "checkers":
      return new CheckersGame();
    case "chess":
      return new ChessGame();
    default:
      throw new Error(`Unknown game type: ${gameType}`);
  }
};

export const getGameState = (game: GameInstance) => {
  return game.getState();
};

export const getGame = (roomId: string): GameInstance | undefined => {
  return activeGames.get(roomId);
};

export const setGame = (roomId: string, game: GameInstance): void => {
  activeGames.set(roomId, game);
};

export const removeGame = (roomId: string): void => {
  activeGames.delete(roomId);
};

export const validateMove = (
  gameType: GameType,
  game: GameInstance,
  move: unknown,
  playerTeam: string,
): { valid: boolean; error?: string; gameState?: unknown } => {
  try {
    let isValid = false;

    if (gameType === "tic_tac_toe") {
      const tttGame = game as TicTacToeGame;
      const moveData = move as { index: number };
      isValid = tttGame.makeMove(moveData.index, playerTeam);
    } else if (gameType === "checkers") {
      const checkersGame = game as CheckersGame;
      const moveData = move as { from: { x: number; y: number }; to: { x: number; y: number } };
      isValid = checkersGame.makeMove(moveData.from, moveData.to, playerTeam);
    } else if (gameType === "chess") {
      const chessGame = game as ChessGame;
      const moveData = move as { 
        from: { x: number; y: number }; 
        to: { x: number; y: number };
        promotionType?: string;
      };
      isValid = chessGame.makeMove(
        moveData.from, 
        moveData.to, 
        playerTeam,
        moveData.promotionType
      );
    }

    if (!isValid) {
      return { valid: false, error: "Invalid move" };
    }

    return { valid: true, gameState: game.getState() };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
};

