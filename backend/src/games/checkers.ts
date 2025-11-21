export class CheckersGame {
  public boardState: (string | null)[][];
  public currentPlayer: string;
  public activePiece: { x: number; y: number } | null;
  public winner: string | null;

  constructor() {
    this.boardState = this.initializeBoard();
    this.currentPlayer = "player1";
    this.activePiece = null;
    this.winner = null;
  }

  private initializeBoard(): (string | null)[][] {
    const board: (string | null)[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(null));

    // Initialize player1 pieces (bottom)
    for (let row = 5; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1) {
          board[row][col] = "player1";
        }
      }
    }

    // Initialize player2 pieces (top)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 8; col++) {
        if ((row + col) % 2 === 1) {
          board[row][col] = "player2";
        }
      }
    }

    return board;
  }

  makeMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    player: string,
  ): boolean {
    if (this.winner !== null) {
      return false;
    }

    if (this.boardState[from.y][from.x] !== player) {
      return false;
    }

    if (this.currentPlayer !== player) {
      return false;
    }

    // Simple move validation (can be enhanced)
    const dx = Math.abs(to.x - from.x);
    const dy = to.y - from.y;

    if (player === "player1" && dy > 0) {
      return false; // player1 moves up
    }
    if (player === "player2" && dy < 0) {
      return false; // player2 moves down
    }

    if (dx !== Math.abs(dy) || dx > 2) {
      return false;
    }

    // Move piece
    this.boardState[to.y][to.x] = this.boardState[from.y][from.x];
    this.boardState[from.y][from.x] = null;

    // Handle jump
    if (dx === 2) {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      this.boardState[midY][midX] = null;
    }

    this.currentPlayer = this.currentPlayer === "player1" ? "player2" : "player1";
    this.checkWinner();

    return true;
  }

  private checkWinner(): void {
    let player1Count = 0;
    let player2Count = 0;

    for (const row of this.boardState) {
      for (const cell of row) {
        if (cell === "player1") {
          player1Count++;
        } else if (cell === "player2") {
          player2Count++;
        }
      }
    }

    if (player1Count === 0) {
      this.winner = "player2";
    } else if (player2Count === 0) {
      this.winner = "player1";
    }
  }

  getState() {
    return {
      boardState: this.boardState,
      currentPlayer: this.currentPlayer,
      activePiece: this.activePiece,
      winner: this.winner,
    };
  }

  reset(): void {
    this.boardState = this.initializeBoard();
    this.currentPlayer = "player1";
    this.activePiece = null;
    this.winner = null;
  }
}

