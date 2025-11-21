interface ChessPiece {
  type: string;
  team: string;
  position: { x: number; y: number };
  hasMoved: boolean;
  enPassant?: boolean; // For pawns that can be captured en passant
}

export class ChessGame {
  public pieces: ChessPiece[];
  public totalTurns: number;
  public currentTeam: string;
  public winningTeam: string | null;
  public pendingPromotion: { x: number; y: number; team: string } | null;

  constructor() {
    this.pieces = this.initializePieces();
    this.totalTurns = 0;
    this.currentTeam = "w";
    this.winningTeam = null;
    this.pendingPromotion = null;
  }

  private initializePieces(): ChessPiece[] {
    const pieces: ChessPiece[] = [];

    // Black pieces (top)
    const blackPieces = [
      { type: "rook", pos: [0, 7] },
      { type: "knight", pos: [1, 7] },
      { type: "bishop", pos: [2, 7] },
      { type: "queen", pos: [3, 7] },
      { type: "king", pos: [4, 7] },
      { type: "bishop", pos: [5, 7] },
      { type: "knight", pos: [6, 7] },
      { type: "rook", pos: [7, 7] },
    ];

    blackPieces.forEach((p) => {
      pieces.push({
        type: p.type,
        team: "b",
        position: { x: p.pos[0], y: p.pos[1] },
        hasMoved: false,
      });
    });

    // Black pawns
    for (let x = 0; x < 8; x++) {
      pieces.push({
        type: "pawn",
        team: "b",
        position: { x, y: 6 },
        hasMoved: false,
      });
    }

    // White pieces (bottom)
    const whitePieces = [
      { type: "rook", pos: [0, 0] },
      { type: "knight", pos: [1, 0] },
      { type: "bishop", pos: [2, 0] },
      { type: "queen", pos: [3, 0] },
      { type: "king", pos: [4, 0] },
      { type: "bishop", pos: [5, 0] },
      { type: "knight", pos: [6, 0] },
      { type: "rook", pos: [7, 0] },
    ];

    whitePieces.forEach((p) => {
      pieces.push({
        type: p.type,
        team: "w",
        position: { x: p.pos[0], y: p.pos[1] },
        hasMoved: false,
      });
    });

    // White pawns
    for (let x = 0; x < 8; x++) {
      pieces.push({
        type: "pawn",
        team: "w",
        position: { x, y: 1 },
        hasMoved: false,
      });
    }

    return pieces;
  }

  private getPieceAt(x: number, y: number): ChessPiece | undefined {
    return this.pieces.find((p) => p.position.x === x && p.position.y === y);
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < 8 && y >= 0 && y < 8;
  }

  private isValidPawnMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    const pawnDirection = team === "w" ? 1 : -1;
    const startRow = team === "w" ? 1 : 6;
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Forward move (one square)
    if (dx === 0 && dy === pawnDirection) {
      return !this.getPieceAt(to.x, to.y);
    }

    // Forward move (two squares from starting position)
    if (
      dx === 0 &&
      dy === 2 * pawnDirection &&
      from.y === startRow &&
      !this.getPieceAt(to.x, to.y) &&
      !this.getPieceAt(from.x, from.y + pawnDirection)
    ) {
      return true;
    }

    // Capture diagonally
    if (Math.abs(dx) === 1 && dy === pawnDirection) {
      const targetPiece = this.getPieceAt(to.x, to.y);
      if (targetPiece && targetPiece.team !== team) {
        return true;
      }
      // Check for en passant
      const adjacentPiece = this.getPieceAt(to.x, from.y);
      if (
        adjacentPiece &&
        adjacentPiece.type === "pawn" &&
        adjacentPiece.team !== team &&
        adjacentPiece.enPassant
      ) {
        return true;
      }
    }

    return false;
  }

  private isValidRookMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    // Must move horizontally or vertically
    if (from.x !== to.x && from.y !== to.y) {
      return false;
    }

    const dx = to.x === from.x ? 0 : to.x > from.x ? 1 : -1;
    const dy = to.y === from.y ? 0 : to.y > from.y ? 1 : -1;

    // Check if path is clear
    let x = from.x + dx;
    let y = from.y + dy;
    while (x !== to.x || y !== to.y) {
      if (this.getPieceAt(x, y)) {
        return false;
      }
      x += dx;
      y += dy;
    }

    // Destination must be empty or occupied by opponent
    const targetPiece = this.getPieceAt(to.x, to.y);
    return !targetPiece || targetPiece.team !== team;
  }

  private isValidBishopMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    // Must move diagonally
    if (Math.abs(to.x - from.x) !== Math.abs(to.y - from.y)) {
      return false;
    }

    const dx = to.x > from.x ? 1 : -1;
    const dy = to.y > from.y ? 1 : -1;

    // Check if path is clear
    let x = from.x + dx;
    let y = from.y + dy;
    while (x !== to.x && y !== to.y) {
      if (this.getPieceAt(x, y)) {
        return false;
      }
      x += dx;
      y += dy;
    }

    // Destination must be empty or occupied by opponent
    const targetPiece = this.getPieceAt(to.x, to.y);
    return !targetPiece || targetPiece.team !== team;
  }

  private isValidKnightMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);

    // Knight moves in L-shape: (2,1) or (1,2)
    if (!((dx === 2 && dy === 1) || (dx === 1 && dy === 2))) {
      return false;
    }

    // Destination must be empty or occupied by opponent
    const targetPiece = this.getPieceAt(to.x, to.y);
    return !targetPiece || targetPiece.team !== team;
  }

  private isValidQueenMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    // Queen combines rook and bishop moves
    return (
      this.isValidRookMove(from, to, team) ||
      this.isValidBishopMove(from, to, team)
    );
  }

  private isValidKingMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);

    // King moves one square in any direction
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
      return false;
    }

    // Destination must be empty or occupied by opponent
    const targetPiece = this.getPieceAt(to.x, to.y);
    return !targetPiece || targetPiece.team !== team;
  }

  private isValidMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
  ): boolean {
    if (!this.isInBounds(to.x, to.y)) {
      return false;
    }

    const piece = this.getPieceAt(from.x, from.y);
    if (!piece || piece.team !== team) {
      return false;
    }

    switch (piece.type) {
      case "pawn":
        return this.isValidPawnMove(from, to, team);
      case "rook":
        return this.isValidRookMove(from, to, team);
      case "bishop":
        return this.isValidBishopMove(from, to, team);
      case "knight":
        return this.isValidKnightMove(from, to, team);
      case "queen":
        return this.isValidQueenMove(from, to, team);
      case "king":
        return this.isValidKingMove(from, to, team);
      default:
        return false;
    }
  }

  private isKingInCheck(team: string): boolean {
    const king = this.pieces.find(
      (p) => p.type === "king" && p.team === team,
    );
    if (!king) {
      return false;
    }

    const opponentTeam = team === "w" ? "b" : "w";
    const opponentPieces = this.pieces.filter((p) => p.team === opponentTeam);

    for (const piece of opponentPieces) {
      if (
        this.isValidMove(
          piece.position,
          king.position,
          piece.team,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  makeMove(
    from: { x: number; y: number },
    to: { x: number; y: number },
    team: string,
    promotionType?: string, // For pawn promotion: 'queen', 'rook', 'bishop', 'knight'
  ): boolean {
    if (this.winningTeam !== null) {
      return false;
    }

    if (this.currentTeam !== team) {
      return false;
    }

    const piece = this.getPieceAt(from.x, from.y);
    if (!piece || piece.team !== team) {
      return false;
    }

    // Check if move is valid
    if (!this.isValidMove(from, to, team)) {
      return false;
    }

    // Simulate the move to check if it puts own king in check
    const originalPosition = { ...piece.position };
    const originalHasMoved = piece.hasMoved;
    const capturedPiece = this.pieces.find(
      (p) => p.position.x === to.x && p.position.y === to.y && p.team !== team,
    );
    const capturedIndex = this.pieces.indexOf(capturedPiece!);

    // Temporarily move the piece
    piece.position = { x: to.x, y: to.y };
    if (capturedIndex !== -1) {
      this.pieces.splice(capturedIndex, 1);
    }

    // Check if this move puts own king in check (illegal move)
    const wouldBeInCheck = this.isKingInCheck(team);

    // Revert the temporary move
    piece.position = originalPosition;
    if (capturedIndex !== -1) {
      this.pieces.splice(capturedIndex, 0, capturedPiece!);
    }

    if (wouldBeInCheck) {
      return false;
    }

    // Handle en passant capture
    let enPassantCapture: { x: number; y: number } | null = null;
    if (piece.type === "pawn") {
      const dx = Math.abs(to.x - from.x);
      const dy = to.y - from.y;
      const pawnDirection = team === "w" ? 1 : -1;

      // Check if this is an en passant capture
      if (dx === 1 && dy === pawnDirection) {
        const adjacentPiece = this.getPieceAt(to.x, from.y);
        if (
          adjacentPiece &&
          adjacentPiece.type === "pawn" &&
          adjacentPiece.team !== team &&
          adjacentPiece.enPassant
        ) {
          enPassantCapture = { x: to.x, y: from.y };
        }
      }

      // Mark pawn for en passant if it moves two squares
      if (Math.abs(dy) === 2) {
        piece.enPassant = true;
      }
    }

    // Clear en passant flags for all pawns (except the one that just moved two squares)
    this.pieces.forEach((p) => {
      if (p.type === "pawn" && p !== piece) {
        p.enPassant = false;
      }
    });

    // Remove captured piece (normal capture or en passant)
    if (enPassantCapture) {
      const epIndex = this.pieces.findIndex(
        (p) =>
          p.position.x === enPassantCapture!.x &&
          p.position.y === enPassantCapture!.y,
      );
      if (epIndex !== -1) {
        this.pieces.splice(epIndex, 1);
      }
    } else {
      const capturedIndex2 = this.pieces.findIndex(
        (p) => p.position.x === to.x && p.position.y === to.y && p.team !== team,
      );
      if (capturedIndex2 !== -1) {
        this.pieces.splice(capturedIndex2, 1);
      }
    }

    // Move the piece
    piece.position = { x: to.x, y: to.y };
    piece.hasMoved = true;

    // Handle pawn promotion
    if (piece.type === "pawn") {
      const promotionRow = team === "w" ? 7 : 0;
      if (to.y === promotionRow) {
        if (promotionType) {
          // Promote the pawn
          piece.type = promotionType;
          this.pendingPromotion = null;
        } else {
          // Set pending promotion - don't complete the move yet
          this.pendingPromotion = { x: to.x, y: to.y, team };
          // Don't increment turn or change currentTeam until promotion is chosen
          return true; // Move is valid, but promotion is pending
        }
      }
    }

    this.totalTurns++;
    this.currentTeam = this.currentTeam === "w" ? "b" : "w";

    // Check for checkmate
    if (this.isKingInCheck(this.currentTeam)) {
      // Check if the current team has any valid moves
      const hasValidMoves = this.pieces
        .filter((p) => p.team === this.currentTeam)
        .some((p) => {
          for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
              if (this.isValidMove(p.position, { x, y }, p.team)) {
                // Simulate move to check if it's legal
                const originalPos = { ...p.position };
                const targetPiece = this.getPieceAt(x, y);
                const targetIndex = targetPiece ? this.pieces.indexOf(targetPiece) : -1;
                
                p.position = { x, y };
                if (targetIndex !== -1 && targetPiece!.team !== p.team) {
                  this.pieces.splice(targetIndex, 1);
                }
                
                const isLegal = !this.isKingInCheck(this.currentTeam);
                
                p.position = originalPos;
                if (targetIndex !== -1) {
                  this.pieces.splice(targetIndex, 0, targetPiece!);
                }
                
                if (isLegal) {
                  return true;
                }
              }
            }
          }
          return false;
        });

      if (!hasValidMoves) {
        this.winningTeam = team; // The team that made the move wins
      }
    }

    return true;
  }

  promotePawn(
    position: { x: number; y: number },
    promotionType: string,
    team: string,
  ): boolean {
    if (!this.pendingPromotion) {
      return false;
    }

    if (
      this.pendingPromotion.x !== position.x ||
      this.pendingPromotion.y !== position.y ||
      this.pendingPromotion.team !== team
    ) {
      return false;
    }

    const validPromotionTypes = ["queen", "rook", "bishop", "knight"];
    if (!validPromotionTypes.includes(promotionType)) {
      return false;
    }

    const piece = this.getPieceAt(position.x, position.y);
    if (!piece || piece.type !== "pawn" || piece.team !== team) {
      return false;
    }

    piece.type = promotionType;
    this.pendingPromotion = null;
    
    // Now complete the move by incrementing turn and changing current team
    this.totalTurns++;
    this.currentTeam = this.currentTeam === "w" ? "b" : "w";

    // Check for checkmate after promotion
    if (this.isKingInCheck(this.currentTeam)) {
      const hasValidMoves = this.pieces
        .filter((p) => p.team === this.currentTeam)
        .some((p) => {
          for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
              if (this.isValidMove(p.position, { x, y }, p.team)) {
                const originalPos = { ...p.position };
                const targetPiece = this.getPieceAt(x, y);
                const targetIndex = targetPiece ? this.pieces.indexOf(targetPiece) : -1;
                
                p.position = { x, y };
                if (targetIndex !== -1 && targetPiece!.team !== p.team) {
                  this.pieces.splice(targetIndex, 1);
                }
                
                const isLegal = !this.isKingInCheck(this.currentTeam);
                
                p.position = originalPos;
                if (targetIndex !== -1) {
                  this.pieces.splice(targetIndex, 0, targetPiece!);
                }
                
                if (isLegal) {
                  return true;
                }
              }
            }
          }
          return false;
        });

      if (!hasValidMoves) {
        this.winningTeam = team;
      }
    }
    
    return true;
  }

  getState() {
    return {
      pieces: this.pieces,
      totalTurns: this.totalTurns,
      currentTeam: this.currentTeam,
      winningTeam: this.winningTeam,
      pendingPromotion: this.pendingPromotion,
    };
  }

  reset(): void {
    this.pieces = this.initializePieces();
    this.totalTurns = 0;
    this.currentTeam = "w";
    this.winningTeam = null;
    this.pendingPromotion = null;
  }
}
