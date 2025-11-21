export class TicTacToeGame {
  public board: (string | null)[];
  public currentPlayer: string;
  public winner: string | null;
  public isDraw: boolean;

  constructor() {
    this.board = Array(9).fill(null);
    this.currentPlayer = "X";
    this.winner = null;
    this.isDraw = false;
  }

  makeMove(index: number, player: string): boolean {
    if (this.board[index] !== null || this.winner !== null || this.isDraw) {
      return false;
    }

    if (player !== this.currentPlayer) {
      return false;
    }

    this.board[index] = player;
    this.checkWinner();
    this.currentPlayer = this.currentPlayer === "X" ? "O" : "X";
    return true;
  }

  private checkWinner(): void {
    const winPatterns = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (
        this.board[a] &&
        this.board[a] === this.board[b] &&
        this.board[a] === this.board[c]
      ) {
        this.winner = this.board[a] as string;
        return;
      }
    }

    if (this.board.every((cell) => cell !== null)) {
      this.isDraw = true;
    }
  }

  getState() {
    return {
      board: this.board,
      currentPlayer: this.currentPlayer,
      winner: this.winner,
      isDraw: this.isDraw,
    };
  }

  reset(): void {
    this.board = Array(9).fill(null);
    this.currentPlayer = "X";
    this.winner = null;
    this.isDraw = false;
  }
}

