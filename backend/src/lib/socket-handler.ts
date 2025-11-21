import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/connection.js";

// WebRTC types
type RTCSdpType = "offer" | "answer" | "pranswer" | "rollback";

type RTCSessionDescriptionInit = {
  type: RTCSdpType;
  sdp?: string;
};

type RTCIceCandidateInit = {
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
  usernameFragment?: string | null;
};
import {
  findWaitingRoom,
  createRoom,
  addPlayerToRoom,
  getRoomPlayers,
  updateRoomStatus,
  removePlayerFromRoom,
  getUserRoom,
  checkPlayerInRoom,
  getRoomBettingInfo,
  updateRoomBettingAmount,
  lockRoomBetting,
  getUserBalance,
  updateUserBalance,
} from "../utils/roomManager.js";
import {
  initializeGame,
  getGameState,
  getGame,
  setGame,
  removeGame,
  validateMove,
  GameType,
} from "../utils/gameManager.js";
import { ChessGame } from "../games/chess.js";
import logger from "./logger.js";
import { activeWSConnectionsGauge, totalRequestsCounter } from "./monitor.js";
import { checkAndAutoBanUser } from "../utils/banManager.js";

// Store active games in memory
const userRooms = new Map<string, string>(); // userId -> roomId
const rematchRequests = new Map<string, Set<string>>(); // roomId -> Set of userIds

// Store active user sessions for single login enforcement
const userSessions = new Map<string, string>(); // userId -> socketId
const socketToUser = new Map<string, string>(); // socketId -> userId (reverse mapping)

export const setupSocketHandlers = (io: Server): void => {
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "User connected");
    totalRequestsCounter.inc();
    activeWSConnectionsGauge.inc();

    // Handle user connection (after username login or token auth)
    socket.on("user_connect", async (data: { userId?: string; token?: string }) => {
      try {
        logger.info({ data }, "user_connect received");
        let userId: string | undefined = data.userId;
        
        // If token is provided, verify it and extract userId
        if (data.token && !userId) {
          const { verifyToken } = await import("../utils/jwt.js");
          const payload = verifyToken(data.token);
          if (payload) {
            userId = payload.userId;
          } else {
            socket.emit("error", { message: "Invalid or expired token" });
            return;
          }
        }

        if (!userId) {
          socket.emit("error", { message: "Missing userId or token" });
          return;
        }

        // Check if user exists and is not banned
        const user = (await query(
          "SELECT id, username, COALESCE(display_username, username) as display_username, is_banned, username_set FROM users WHERE id = ?",
          [userId],
        )) as Array<{
          id: string;
          username: string;
          display_username: string;
          is_banned: boolean;
          username_set: boolean;
        }>;

        if (user.length === 0) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        // Check and auto-ban if user has 5+ reports
        const isBanned = await checkAndAutoBanUser(userId);
        if (isBanned) {
          socket.emit("error", {
            message: "Your account has been banned",
            banned: true,
          });
          return;
        }

        if (!user[0].username_set) {
          socket.emit("error", {
            message: "Please set your username first",
            needsUsername: true,
          });
          return;
        }

        // Check if user already has an active session (single login enforcement)
        const existingSocketId = userSessions.get(userId);
        if (existingSocketId && existingSocketId !== socket.id) {
          logger.info({ userId, oldSocketId: existingSocketId, newSocketId: socket.id }, "User already has active session, disconnecting old session");
          
          // Get the old socket and disconnect it
          const oldSocket = io.sockets.sockets.get(existingSocketId);
          if (oldSocket) {
            // Notify old client about new login
            oldSocket.emit("session_terminated", {
              message: "You have been logged in from another device. This session has been terminated.",
              reason: "new_login",
            });
            
            // Clean up old session
            // Note: leaveAll() is private, so we disconnect which automatically leaves all rooms
            userRooms.delete(userId);
            socketToUser.delete(existingSocketId);
            
            // Disconnect old socket
            oldSocket.disconnect(true);
          }
          
          // Clean up if socket doesn't exist anymore
          userSessions.delete(userId);
        }

        // Register new session
        userSessions.set(userId, socket.id);
        socketToUser.set(socket.id, userId);

        // Update session in database
        await query("UPDATE users SET session_id = ? WHERE id = ?", [
          socket.id,
          userId,
        ]);

        (socket as Socket & { userId: string }).userId = userId;
        socket.emit("connected", {
          userId,
          username: user[0].display_username, // Use display_username (second step username) for rooms
        });
      } catch (error) {
        logger.error(error, "Error in user_connect");
        socket.emit("error", { message: "Failed to connect user" });
      }
    });

    // Note: checkAndAutoBanUser is imported from banManager.ts

    // Handle joining random room
    socket.on("join_random", async (data: { gameType: string }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", {
            message: "User not connected. Please authenticate first.",
          });
          return;
        }

        // Check and auto-ban if user has 5+ reports
        const isBanned = await checkAndAutoBanUser(socketWithUserId.userId);
        if (isBanned) {
          socket.emit("error", {
            message: "Your account has been banned",
            banned: true,
          });
          return;
        }

        const { gameType } = data;

        // Check if user is already in a room
        const existingRoom = await getUserRoom(socketWithUserId.userId);
        if (existingRoom) {
          const stillInRoom = await checkPlayerInRoom(
            existingRoom.id,
            socketWithUserId.userId,
          );

          if (
            stillInRoom &&
            existingRoom.game_type === gameType &&
            existingRoom.status === "waiting" &&
            existingRoom.player_count < 2
          ) {
            // User is still in a valid waiting room - rejoin socket room
            socket.join(existingRoom.id);
            userRooms.set(socketWithUserId.userId, existingRoom.id);

            // Load and send chat history
            const chatHistory = (await query(
              "SELECT cm.id, cm.user_id, cm.message, cm.created_at, COALESCE(u.display_username, u.username) as username FROM chat_messages cm JOIN users u ON cm.user_id = u.id WHERE cm.room_id = ? ORDER BY cm.created_at ASC",
              [existingRoom.id],
            )) as Array<{
              id: string;
              user_id: string;
              message: string;
              created_at: Date;
              username: string;
            }>;

            if (chatHistory.length > 0) {
              socket.emit("chat_history", {
                messages: chatHistory.map((msg) => ({
                  id: msg.id,
                  userId: msg.user_id,
                  username: msg.username,
                  message: msg.message,
                  timestamp: msg.created_at,
                })),
              });
            }

            const players = await getRoomPlayers(existingRoom.id);

            // Initialize game immediately (even with 1 player) so board is visible
            let game = getGame(existingRoom.id);
            if (!game) {
              game = initializeGame(gameType as GameType);
              setGame(existingRoom.id, game);
            }
            const gameState = getGameState(game);

            const bettingInfo = await getRoomBettingInfo(existingRoom.id);
            if (players.length === 2) {
              await updateRoomStatus(existingRoom.id, "playing");
              // Use setTimeout to ensure socket room join is complete
              setTimeout(() => {
                io.to(existingRoom.id).emit("game_start", {
                  roomId: existingRoom.id,
                  gameType,
                  players,
                  gameState,
                  canMove: true, // Allow moves when 2 players are present
                  bettingAmount: bettingInfo?.betting_amount || 0.25,
                  bettingStatus: bettingInfo?.betting_status || "unlocked",
                });
              }, 100);
            } else {
              // Send game state even with 1 player so board is visible
              logger.info(`Sending game_start to single player in existing room ${existingRoom.id}, players: ${players.length}`);
              socket.emit("game_start", {
                roomId: existingRoom.id,
                gameType,
                players,
                gameState,
                canMove: false, // Disable moves until 2 players join
                bettingAmount: bettingInfo?.betting_amount || 0.25,
                bettingStatus: bettingInfo?.betting_status || "unlocked",
              });
              socket.emit("waiting_for_player", {
                roomId: existingRoom.id,
                players,
              });
            }
            return;
          } else {
            if (stillInRoom) {
              await removePlayerFromRoom(existingRoom.id, socketWithUserId.userId);
            }
            socket.leave(existingRoom.id);
            userRooms.delete(socketWithUserId.userId);
          }
        }

        // Look for waiting room with available slot
        let room = await findWaitingRoom(gameType);

        if (!room) {
          // Create new room
          const roomId = await createRoom(gameType);
          await addPlayerToRoom(roomId, socketWithUserId.userId, true);
          room = { id: roomId, player_count: 1 };
        } else {
          // Join existing room
          const currentPlayers = await getRoomPlayers(room.id);
          if (currentPlayers.length >= 2) {
            // Room already full, create new one
            const roomId = await createRoom(gameType);
            await addPlayerToRoom(roomId, socketWithUserId.userId, true);
            room = { id: roomId, player_count: 1 };
          } else {
            const alreadyInRoom = await checkPlayerInRoom(
              room.id,
              socketWithUserId.userId,
            );
            if (!alreadyInRoom) {
              await addPlayerToRoom(room.id, socketWithUserId.userId, false);
            }
          }
        }

        // Join socket room FIRST before checking players
        socket.join(room.id);
        userRooms.set(socketWithUserId.userId, room.id);

        // Load and send chat history
        const chatHistory = (await query(
          "SELECT cm.id, cm.user_id, cm.message, cm.created_at, COALESCE(u.display_username, u.username) as username FROM chat_messages cm JOIN users u ON cm.user_id = u.id WHERE cm.room_id = ? ORDER BY cm.created_at ASC",
          [room.id],
        )) as Array<{
          id: string;
          user_id: string;
          message: string;
          created_at: Date;
          username: string;
        }>;

        if (chatHistory.length > 0) {
          socket.emit("chat_history", {
            messages: chatHistory.map((msg) => ({
              id: msg.id,
              userId: msg.user_id,
              username: msg.username,
              message: msg.message,
              timestamp: msg.created_at,
            })),
          });
        }

        const players = await getRoomPlayers(room.id);

        // Initialize game immediately (even with 1 player) so board is visible
        let game = getGame(room.id);
        if (!game) {
          game = initializeGame(gameType as GameType);
          setGame(room.id, game);
        }
        const gameState = getGameState(game);

        const bettingInfo = await getRoomBettingInfo(room.id);
        if (players.length === 2) {
          await updateRoomStatus(room.id, "playing");
          // Use setTimeout to ensure socket room join is complete
          setTimeout(() => {
            io.to(room.id).emit("game_start", {
              roomId: room.id,
              gameType,
              players,
              gameState,
              canMove: true, // Allow moves when 2 players are present
              bettingAmount: bettingInfo?.betting_amount || 0.25,
              bettingStatus: bettingInfo?.betting_status || "unlocked",
            });
          }, 100);
        } else {
          // Send game state even with 1 player so board is visible
          logger.info(`Sending game_start to single player in room ${room.id}, players: ${players.length}`);
          socket.emit("game_start", {
            roomId: room.id,
            gameType,
            players,
            gameState,
            canMove: false, // Disable moves until 2 players join
            bettingAmount: bettingInfo?.betting_amount || 0.25,
            bettingStatus: bettingInfo?.betting_status || "unlocked",
          });
          socket.emit("waiting_for_player", { roomId: room.id, players });
          // Only emit player_joined to other players in the room (if any)
          if (players.length > 1) {
            socket.to(room.id).emit("player_joined", {
              roomId: room.id,
              players,
            });
          }
        }
      } catch (error) {
        logger.error(error, "Error in join_random");
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    // Handle joining by keyword
    socket.on(
      "join_keyword",
      async (data: { gameType: string; keyword: string }) => {
        try {
          const socketWithUserId = socket as Socket & { userId?: string };
          if (!socketWithUserId.userId) {
            socket.emit("error", { message: "User not connected" });
            return;
          }

          // Check and auto-ban if user has 5+ reports
          const isBanned = await checkAndAutoBanUser(socketWithUserId.userId);
          if (isBanned) {
            socket.emit("error", {
              message: "Your account has been banned",
              banned: true,
            });
            return;
          }

          const { gameType, keyword } = data;
          let room = null;

          // Check if room with keyword exists and has space
          const keywordRooms = (await query(
            "SELECT r.id, r.game_type, r.status, COUNT(rp.user_id) as player_count FROM rooms r LEFT JOIN room_players rp ON r.id = rp.room_id WHERE r.keyword = ? AND r.game_type = ? GROUP BY r.id HAVING player_count < 2",
            [keyword, gameType],
          )) as Array<{
            id: string;
            game_type: string;
            status: string;
            player_count: number;
          }>;

          if (keywordRooms.length > 0) {
            room = keywordRooms[0];
          }

          if (!room) {
            const roomId = await createRoom(gameType, keyword);
            await addPlayerToRoom(roomId, socketWithUserId.userId, true);
            room = { id: roomId, player_count: 0 };
          } else {
            const alreadyInRoom = await checkPlayerInRoom(
              room.id,
              socketWithUserId.userId,
            );
            if (!alreadyInRoom) {
              await addPlayerToRoom(room.id, socketWithUserId.userId, false);
            }
          }

          socket.join(room.id);
          userRooms.set(socketWithUserId.userId, room.id);

          const players = await getRoomPlayers(room.id);

          // Initialize game immediately (even with 1 player) so board is visible
          let game = getGame(room.id);
          if (!game) {
            game = initializeGame(gameType as GameType);
            setGame(room.id, game);
          }
          const gameState = getGameState(game);
          const bettingInfo = await getRoomBettingInfo(room.id);

          if (players.length === 2) {
            await updateRoomStatus(room.id, "playing");
            // Use setTimeout to ensure socket room join is complete
            setTimeout(() => {
              io.to(room.id).emit("game_start", {
                roomId: room.id,
                gameType,
                players,
                gameState,
                canMove: true, // Allow moves when 2 players are present
                bettingAmount: bettingInfo?.betting_amount || 0.25,
                bettingStatus: bettingInfo?.betting_status || "unlocked",
              });
            }, 100);
          } else {
            // Send game state even with 1 player so board is visible
            logger.info(`Sending game_start to single player in keyword room ${room.id}, players: ${players.length}`);
            socket.emit("game_start", {
              roomId: room.id,
              gameType,
              players,
              gameState,
              canMove: false, // Disable moves until 2 players join
              bettingAmount: bettingInfo?.betting_amount || 0.25,
              bettingStatus: bettingInfo?.betting_status || "unlocked",
            });
            socket.emit("waiting_for_player", { roomId: room.id, players });
            // Only emit player_joined to other players in the room (if any)
            if (players.length > 1) {
              socket.to(room.id).emit("player_joined", {
                roomId: room.id,
                players,
              });
            }
          }
        } catch (error) {
          logger.error(error, "Error in join_keyword");
          socket.emit("error", { message: "Failed to join room" });
        }
      },
    );

    // Handle request for current game state (when user joins/reconnects)
    socket.on("request_game_state", async () => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const game = getGame(roomId);
        if (game) {
          // Get game type from database
          const roomInfo = (await query(
            "SELECT game_type FROM rooms WHERE id = ?",
            [roomId],
          )) as Array<{ game_type: string }>;
          
          if (roomInfo.length === 0) {
            socket.emit("error", { message: "Room not found" });
            return;
          }
          
          const gameType = roomInfo[0].game_type;
          const players = await getRoomPlayers(roomId);
          const gameState = getGameState(game);
          const playerCount = players.length;
          const bettingInfo = await getRoomBettingInfo(roomId);
          
          socket.emit("game_start", {
            roomId: roomId,
            gameType: gameType,
            players,
            gameState,
            canMove: playerCount >= 2,
            bettingAmount: bettingInfo?.betting_amount || 0.25,
            bettingStatus: bettingInfo?.betting_status || "unlocked",
          });
          logger.info(`Sent game state to user ${socketWithUserId.userId} for room ${roomId}, gameType: ${gameType}`);
        } else {
          logger.info(`No game found for room ${roomId} when user ${socketWithUserId.userId} requested state`);
        }
      } catch (error) {
        logger.error(error, "Error in request_game_state");
        socket.emit("error", { message: "Failed to get game state" });
      }
    });

    // Handle player move
    socket.on("player_move", async (data: { gameType: string; move: unknown }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        // Check and auto-ban if user has 5+ reports
        const isBanned = await checkAndAutoBanUser(socketWithUserId.userId);
        if (isBanned) {
          socket.emit("error", {
            message: "Your account has been banned",
            banned: true,
          });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const game = getGame(roomId);
        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        const players = await getRoomPlayers(roomId);
        
        // Check if 2 players are present before allowing moves
        if (players.length < 2) {
          socket.emit("error", { message: "Waiting for another player to join" });
          return;
        }
        const currentPlayerIndex = players.findIndex(
          (p) => p.id === socketWithUserId.userId,
        );
        let playerTeam: string;

        if (data.gameType === "tic_tac_toe") {
          playerTeam = currentPlayerIndex === 0 ? "X" : "O";
        } else if (data.gameType === "checkers") {
          playerTeam = currentPlayerIndex === 0 ? "player1" : "player2";
        } else if (data.gameType === "chess") {
          playerTeam = currentPlayerIndex === 0 ? "w" : "b";
        } else {
          socket.emit("error", { message: "Invalid game type" });
          return;
        }

        const result = validateMove(
          data.gameType as GameType,
          game,
          data.move,
          playerTeam,
        );

        if (!result.valid) {
          logger.error(`Invalid move from user ${socketWithUserId.userId}: ${result.error}`);
          socket.emit("error", { message: result.error || "Invalid move" });
          return;
        }
        
        logger.info(`Valid move from user ${socketWithUserId.userId}, team ${playerTeam}, gameType ${data.gameType}`);

        // Broadcast move to all players in room (including the player who made the move)
        const updatedState = getGameState(game);
        
        // Check if pawn promotion is pending
        const chessState = updatedState as {
          pendingPromotion?: { x: number; y: number; team: string } | null;
        };
        
        if (data.gameType === "chess" && chessState.pendingPromotion) {
          // Emit promotion request to the player who made the move
          socket.emit("pawn_promotion_required", {
            position: chessState.pendingPromotion,
            roomId: roomId,
          });
        }
        
        io.to(roomId).emit("move_update", {
          move: data.move,
          gameState: updatedState,
          roomId: roomId,
        });

        // Check if game is over
        const gameState = game.getState() as {
          winner?: string;
          isDraw?: boolean;
          winningTeam?: string;
        };

        if (gameState.winner || gameState.isDraw || gameState.winningTeam) {
          await updateRoomStatus(roomId, "finished");

          const winnerId =
            gameState.winner || gameState.winningTeam
              ? players.find((p, idx) => {
                  if (data.gameType === "tic_tac_toe") {
                    return (
                      gameState.winner === (idx === 0 ? "X" : "O")
                    );
                  } else if (data.gameType === "checkers") {
                    return (
                      gameState.winner ===
                      (idx === 0 ? "player1" : "player2")
                    );
                  } else if (data.gameType === "chess") {
                    return (
                      gameState.winningTeam === (idx === 0 ? "w" : "b")
                    );
                  }
                  return false;
                })?.id
              : null;

          const matchId = uuidv4();
          await query(
            `INSERT INTO matches (id, room_id, game_type, winner_id, moves_json, result)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              matchId,
              roomId,
              data.gameType,
              winnerId,
              JSON.stringify([data.move]),
              gameState.isDraw
                ? "draw"
                : winnerId === socketWithUserId.userId
                  ? "win"
                  : "loss",
            ],
          );

          // Process betting payouts
          const bettingInfo = await getRoomBettingInfo(roomId);
          if (bettingInfo && bettingInfo.betting_status === "locked") {
            const bettingAmount = bettingInfo.betting_amount;
            const totalPot = bettingAmount * 2; // Both players bet
            const platformFee = totalPot * 0.1; // 10% platform fee
            const winnerPayout = totalPot * 0.9; // 90% to winner

            if (!gameState.isDraw && winnerId) {
              // Winner gets 90% of the pot
              const winnerBalance = await getUserBalance(winnerId);
              const newWinnerBalance = winnerBalance + winnerPayout;
              await updateUserBalance(winnerId, newWinnerBalance);

              // Record winner transaction
              await query(
                `INSERT INTO betting_transactions 
                 (id, room_id, match_id, user_id, transaction_type, amount, balance_before, balance_after)
                 VALUES (?, ?, ?, ?, 'bet_won', ?, ?, ?)`,
                [
                  uuidv4(),
                  roomId,
                  matchId,
                  winnerId,
                  winnerPayout,
                  winnerBalance,
                  newWinnerBalance,
                ],
              );

              // Loser loses their bet (already deducted when betting was locked)
              const loserId = players.find((p) => p.id !== winnerId)?.id;
              if (loserId) {
                const loserBalance = await getUserBalance(loserId);
                await query(
                  `INSERT INTO betting_transactions 
                   (id, room_id, match_id, user_id, transaction_type, amount, balance_before, balance_after)
                   VALUES (?, ?, ?, ?, 'bet_lost', ?, ?, ?)`,
                  [
                    uuidv4(),
                    roomId,
                    matchId,
                    loserId,
                    -bettingAmount,
                    loserBalance + bettingAmount, // balance before bet was placed
                    loserBalance,
                  ],
                );
              }

              // Platform fee (stored as a system transaction)
              await query(
                `INSERT INTO betting_transactions 
                 (id, room_id, match_id, user_id, transaction_type, amount, balance_before, balance_after)
                 VALUES (?, ?, ?, ?, 'platform_fee', ?, 0, ?)`,
                [
                  uuidv4(),
                  roomId,
                  matchId,
                  winnerId, // Reference user for the transaction
                  platformFee,
                  platformFee,
                ],
              );

              logger.info(
                `Betting payout: Winner ${winnerId} received ${winnerPayout} BRL, Platform fee: ${platformFee} BRL`,
              );

              // Emit balance updates to all players in the room
              const updatedBalances: Array<{ userId: string; balance: number }> = [];
              for (const player of players) {
                const currentBalance = await getUserBalance(player.id);
                updatedBalances.push({ userId: player.id, balance: currentBalance });
              }
              
              // Emit balance update event to all players
              io.to(roomId).emit("balance_updated", {
                roomId,
                balances: updatedBalances,
                winnerId,
                winnerPayout,
                isDraw: false,
              });
            } else if (gameState.isDraw) {
              // Draw: refund both players
              for (const player of players) {
                const playerBalance = await getUserBalance(player.id);
                const newBalance = playerBalance + bettingAmount;
                await updateUserBalance(player.id, newBalance);

                await query(
                  `INSERT INTO betting_transactions 
                   (id, room_id, match_id, user_id, transaction_type, amount, balance_before, balance_after)
                   VALUES (?, ?, ?, ?, 'refund', ?, ?, ?)`,
                  [
                    uuidv4(),
                    roomId,
                    matchId,
                    player.id,
                    bettingAmount,
                    playerBalance,
                    newBalance,
                  ],
                );
              }
              logger.info(`Betting refunded due to draw for room ${roomId}`);

              // Emit balance updates for draw (refund)
              const updatedBalances: Array<{ userId: string; balance: number }> = [];
              for (const player of players) {
                const currentBalance = await getUserBalance(player.id);
                updatedBalances.push({ userId: player.id, balance: currentBalance });
              }
              
              // Emit balance update event to all players
              io.to(roomId).emit("balance_updated", {
                roomId,
                balances: updatedBalances,
                winnerId: null,
                refundAmount: bettingAmount,
                isDraw: true,
              });
            }
          }

          io.to(roomId).emit("game_over", {
            winner: gameState.winner || gameState.winningTeam,
            isDraw: gameState.isDraw,
            gameState: updatedState,
          });
        }
      } catch (error) {
        logger.error(error, "Error in player_move");
        socket.emit("error", { message: "Failed to process move" });
      }
    });

    // Handle pawn promotion
    socket.on("pawn_promotion", async (data: { 
      position: { x: number; y: number }; 
      promotionType: string;
      gameType: string;
    }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        if (data.gameType !== "chess") {
          socket.emit("error", { message: "Invalid game type for promotion" });
          return;
        }

        const game = getGame(roomId);
        if (!game) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        const players = await getRoomPlayers(roomId);
        const currentPlayerIndex = players.findIndex(
          (p) => p.id === socketWithUserId.userId,
        );
        const playerTeam = currentPlayerIndex === 0 ? "w" : "b";

        const chessGame = game as ChessGame;
        const success = chessGame.promotePawn(
          data.position,
          data.promotionType,
          playerTeam,
        );

        if (!success) {
          socket.emit("error", { message: "Invalid promotion" });
          return;
        }

        const updatedState = getGameState(game);
        io.to(roomId).emit("move_update", {
          move: { type: "promotion", position: data.position, promotionType: data.promotionType },
          gameState: updatedState,
          roomId: roomId,
        });

        logger.info(`Pawn promoted by user ${socketWithUserId.userId} to ${data.promotionType}`);
      } catch (error) {
        logger.error(error, "Error in pawn_promotion");
        socket.emit("error", { message: "Failed to promote pawn" });
      }
    });

    // Handle user report
    socket.on("report_user", async (data: {
      reportedUserId: string;
      reason: string;
    }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const { reportedUserId, reason } = data;

        if (!reportedUserId || !reason) {
          socket.emit("error", { message: "Missing reportedUserId or reason" });
          return;
        }

        // Can't report yourself
        if (socketWithUserId.userId === reportedUserId) {
          socket.emit("error", { message: "Cannot report yourself" });
          return;
        }

        // Check if reported user is already banned
        const reportedUser = (await query(
          "SELECT is_banned FROM users WHERE id = ?",
          [reportedUserId],
        )) as Array<{ is_banned: boolean }>;

        if (reportedUser.length === 0) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        if (reportedUser[0].is_banned) {
          socket.emit("error", { message: "This user is already banned" });
          return;
        }

        // Check if already reported by this user in this room
        const roomId = userRooms.get(socketWithUserId.userId);
        const existingReport = (await query(
          "SELECT id FROM reports WHERE reported_user_id = ? AND reporter_user_id = ? AND (room_id = ? OR room_id IS NULL)",
          [reportedUserId, socketWithUserId.userId, roomId || null],
        )) as Array<{ id: string }>;

        if (existingReport.length > 0) {
          socket.emit("error", {
            message: "You have already reported this user",
          });
          return;
        }

        // Create report
        const reportId = uuidv4();
        await query(
          `INSERT INTO reports (id, reported_user_id, reporter_user_id, room_id, reason)
           VALUES (?, ?, ?, ?, ?)`,
          [
            reportId,
            reportedUserId,
            socketWithUserId.userId,
            roomId || null,
            reason,
          ],
        );

        // Increment report count
        await query(
          "UPDATE users SET report_count = report_count + 1 WHERE id = ?",
          [reportedUserId],
        );

        // Check if user should be banned (5 reports)
        const userReportCount = (await query(
          "SELECT report_count FROM users WHERE id = ?",
          [reportedUserId],
        )) as Array<{ report_count: number }>;

        if (userReportCount.length > 0 && userReportCount[0].report_count >= 5) {
          // Ban the user
          await query(
            `UPDATE users 
             SET is_banned = TRUE, banned_at = NOW(), ban_reason = ?
             WHERE id = ?`,
            [
              `Account banned due to ${userReportCount[0].report_count} reports`,
              reportedUserId,
            ],
          );

          // Notify all sockets of this user to disconnect
          const bannedUserSockets = await io.in(reportedUserId).fetchSockets();
          for (const bannedSocket of bannedUserSockets) {
            bannedSocket.emit("account_banned", {
              message: "Your account has been banned due to multiple reports",
            });
            bannedSocket.disconnect();
          }

          logger.info(
            `User ${reportedUserId} banned due to ${userReportCount[0].report_count} reports`,
          );
        }

        socket.emit("report_success", {
          message: "User reported successfully",
        });

        logger.info(
          `User ${socketWithUserId.userId} reported ${reportedUserId} for: ${reason}`,
        );
      } catch (error) {
        logger.error(error, "Error in report_user");
        socket.emit("error", { message: "Failed to report user" });
      }
    });

    // Handle chat message
    socket.on("chat_message", async (data: { message: string }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const { message } = data;
        const sanitizedMessage = message.substring(0, 500).replace(/<[^>]*>/g, "");

        // Save to database
        const messageId = uuidv4();
        await query(
          "INSERT INTO chat_messages (id, room_id, user_id, message) VALUES (?, ?, ?, ?)",
          [messageId, roomId, socketWithUserId.userId, sanitizedMessage],
        );

        // Get display username (second step username) for chat
        const user = (await query("SELECT COALESCE(display_username, username) as username FROM users WHERE id = ?", [
          socketWithUserId.userId,
        ])) as Array<{ username: string }>;
        const username = user[0]?.username || "Unknown";

        // Broadcast to room
        io.to(roomId).emit("chat_message", {
          id: messageId,
          userId: socketWithUserId.userId,
          username,
          message: sanitizedMessage,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(error, "Error in chat_message");
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Handle betting amount proposal
    socket.on("propose_betting_amount", async (data: { amount: number }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const players = await getRoomPlayers(roomId);
        if (players.length < 2) {
          socket.emit("error", {
            message: "Need 2 players to change betting amount",
          });
          return;
        }

        const bettingInfo = await getRoomBettingInfo(roomId);
        if (bettingInfo?.betting_status === "locked") {
          socket.emit("error", {
            message: "Betting amount is already locked",
          });
          return;
        }

        if (data.amount <= 0) {
          socket.emit("error", {
            message: "Betting amount must be greater than 0",
          });
          return;
        }

        // Check if user has sufficient balance
        const userBalance = await getUserBalance(socketWithUserId.userId);
        if (userBalance < data.amount) {
          socket.emit("error", {
            message: "Insufficient balance",
          });
          return;
        }

        // Create or update proposal
        const existingProposal = (await query(
          `SELECT id FROM betting_proposals 
           WHERE room_id = ? AND proposer_user_id = ? AND status = 'pending'`,
          [roomId, socketWithUserId.userId],
        )) as Array<{ id: string }>;

        const proposalId = existingProposal.length > 0
          ? existingProposal[0].id
          : uuidv4();

        if (existingProposal.length > 0) {
          await query(
            `UPDATE betting_proposals 
             SET proposed_amount = ?, updated_at = NOW() 
             WHERE id = ?`,
            [data.amount, proposalId],
          );
        } else {
          await query(
            `INSERT INTO betting_proposals 
             (id, room_id, proposer_user_id, proposed_amount, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [proposalId, roomId, socketWithUserId.userId, data.amount],
          );
        }

        // Notify other player
        const otherPlayer = players.find((p) => p.id !== socketWithUserId.userId);
        if (otherPlayer) {
          io.to(roomId).emit("betting_proposal", {
            proposerId: socketWithUserId.userId,
            proposedAmount: data.amount,
            roomId,
          });
        }

        socket.emit("betting_proposal_sent", {
          amount: data.amount,
        });
      } catch (error) {
        logger.error(error, "Error in propose_betting_amount");
        socket.emit("error", { message: "Failed to propose betting amount" });
      }
    });

    // Handle betting amount acceptance
    socket.on("accept_betting_amount", async (data: { amount: number }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const players = await getRoomPlayers(roomId);
        if (players.length < 2) {
          socket.emit("error", {
            message: "Need 2 players to accept betting amount",
          });
          return;
        }

        const bettingInfo = await getRoomBettingInfo(roomId);
        if (bettingInfo?.betting_status === "locked") {
          socket.emit("error", {
            message: "Betting amount is already locked",
          });
          return;
        }

        // Find the proposal
        const proposal = (await query(
          `SELECT id, proposer_user_id, proposed_amount 
           FROM betting_proposals 
           WHERE room_id = ? AND proposed_amount = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [roomId, data.amount],
        )) as Array<{
          id: string;
          proposer_user_id: string;
          proposed_amount: number;
        }>;

        if (proposal.length === 0) {
          socket.emit("error", {
            message: "No matching proposal found",
          });
          return;
        }

        // Check if both players have sufficient balance
        for (const player of players) {
          const playerBalance = await getUserBalance(player.id);
          if (playerBalance < data.amount) {
            socket.emit("error", {
              message: `${player.username} has insufficient balance`,
            });
            return;
          }
        }

        // Update proposal status
        await query(
          `UPDATE betting_proposals SET status = 'accepted' WHERE id = ?`,
          [proposal[0].id],
        );

        // Update room betting amount
        await updateRoomBettingAmount(roomId, data.amount);

        // Lock betting and deduct amounts from both players
        await lockRoomBetting(roomId);

        // Deduct betting amount from both players
        for (const player of players) {
          const playerBalance = await getUserBalance(player.id);
          const newBalance = playerBalance - data.amount;
          await updateUserBalance(player.id, newBalance);

          // Record transaction
          await query(
            `INSERT INTO betting_transactions 
             (id, room_id, user_id, transaction_type, amount, balance_before, balance_after)
             VALUES (?, ?, ?, 'bet_placed', ?, ?, ?)`,
            [
              uuidv4(),
              roomId,
              player.id,
              -data.amount,
              playerBalance,
              newBalance,
            ],
          );
        }

        // Notify all players in room
        io.to(roomId).emit("betting_locked", {
          amount: data.amount,
          roomId,
        });

        logger.info(
          `Betting locked for room ${roomId} with amount ${data.amount} BRL`,
        );
      } catch (error) {
        logger.error(error, "Error in accept_betting_amount");
        socket.emit("error", { message: "Failed to accept betting amount" });
      }
    });

    // Handle betting amount rejection
    socket.on("reject_betting_amount", async () => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        // Update pending proposals to rejected
        await query(
          `UPDATE betting_proposals 
           SET status = 'rejected' 
           WHERE room_id = ? AND status = 'pending'`,
          [roomId],
        );

        // Notify proposer
        io.to(roomId).emit("betting_proposal_rejected", {
          roomId,
        });

        socket.emit("betting_proposal_rejected_sent");
      } catch (error) {
        logger.error(error, "Error in reject_betting_amount");
        socket.emit("error", { message: "Failed to reject betting amount" });
      }
    });

    // Handle request for betting info
    socket.on("get_betting_info", async () => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) {
          socket.emit("error", { message: "User not connected" });
          return;
        }

        const roomId = userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        const bettingInfo = await getRoomBettingInfo(roomId);
        const userBalance = await getUserBalance(socketWithUserId.userId);

        // Convert betting_amount from MySQL DECIMAL (string) to number
        const bettingAmount = bettingInfo?.betting_amount 
          ? (typeof bettingInfo.betting_amount === 'number' 
              ? bettingInfo.betting_amount 
              : Number(bettingInfo.betting_amount || 0.25))
          : 0.25;

        socket.emit("betting_info", {
          bettingAmount,
          bettingStatus: bettingInfo?.betting_status || "unlocked",
          userBalance,
          roomId,
        });
      } catch (error) {
        logger.error(error, "Error in get_betting_info");
        socket.emit("error", { message: "Failed to get betting info" });
      }
    });

    // Handle WebRTC offer
    socket.on("webrtc_offer", (data: { offer: RTCSessionDescriptionInit }) => {
      const socketWithUserId = socket as Socket & { userId?: string };
      const roomId = userRooms.get(socketWithUserId.userId || "");
      if (roomId) {
        socket.to(roomId).emit("webrtc_offer", {
          senderId: socketWithUserId.userId,
          offer: data.offer,
        });
      }
    });

    // Handle WebRTC answer
    socket.on("webrtc_answer", (data: { answer: RTCSessionDescriptionInit }) => {
      const socketWithUserId = socket as Socket & { userId?: string };
      const roomId = userRooms.get(socketWithUserId.userId || "");
      if (roomId) {
        socket.to(roomId).emit("webrtc_answer", {
          senderId: socketWithUserId.userId,
          answer: data.answer,
        });
      }
    });

    // Handle ICE candidate
    socket.on("webrtc_ice_candidate", (data: { candidate: RTCIceCandidateInit }) => {
      const socketWithUserId = socket as Socket & { userId?: string };
      const roomId = userRooms.get(socketWithUserId.userId || "");
      if (roomId) {
        socket.to(roomId).emit("webrtc_ice_candidate", {
          senderId: socketWithUserId.userId,
          candidate: data.candidate,
        });
      }
    });

    // Handle rematch request
    socket.on("rematch_request", async (data: { roomId?: string; gameType?: string }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) return;

        const roomId = data.roomId || userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          socket.emit("error", { message: "Not in a room" });
          return;
        }

        // Get game type from room
        const roomInfo = (await query(
          "SELECT game_type FROM rooms WHERE id = ?",
          [roomId],
        )) as Array<{ game_type: string }>;
        
        if (roomInfo.length === 0) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        const gameType = data.gameType || roomInfo[0].game_type;

        if (!rematchRequests.has(roomId)) {
          rematchRequests.set(roomId, new Set());
        }
        rematchRequests.get(roomId)!.add(socketWithUserId.userId);

        const players = await getRoomPlayers(roomId);
        if (rematchRequests.get(roomId)!.size === players.length) {
          const game = initializeGame(gameType as GameType);
          setGame(roomId, game);
          await updateRoomStatus(roomId, "playing");
          rematchRequests.delete(roomId);

          // Unlock betting for rematch so players can negotiate new amount
          await query(
            `UPDATE rooms SET betting_status = 'unlocked', betting_amount = 0.25 WHERE id = ?`,
            [roomId],
          );

          // Clear any pending betting proposals for this room
          await query(
            `UPDATE betting_proposals SET status = 'rejected' WHERE room_id = ? AND status = 'pending'`,
            [roomId],
          );

          const gameState = getGameState(game);
          const bettingInfo = await getRoomBettingInfo(roomId);
          
          // Get updated balances for all players
          const updatedBalances: Array<{ userId: string; balance: number }> = [];
          for (const player of players) {
            const currentBalance = await getUserBalance(player.id);
            updatedBalances.push({ userId: player.id, balance: currentBalance });
          }
          
          io.to(roomId).emit("new_match_start", {
            roomId,
            gameType,
            players,
            gameState,
            bettingAmount: bettingInfo?.betting_amount || 0.25,
            bettingStatus: bettingInfo?.betting_status || "unlocked",
            balances: updatedBalances,
          });
        } else {
          socket.emit("rematch_pending", { roomId });
        }
      } catch (error) {
        logger.error(error, "Error in rematch_request");
        socket.emit("error", { message: "Failed to request rematch" });
      }
    });

    // Handle leave room
    socket.on("leave_room", async (data: { roomId?: string }) => {
      try {
        const socketWithUserId = socket as Socket & { userId?: string };
        if (!socketWithUserId.userId) return;

        const roomId = data.roomId || userRooms.get(socketWithUserId.userId);
        if (!roomId) {
          logger.warn("User tried to leave room but not in any room");
          return;
        }

        await removePlayerFromRoom(roomId, socketWithUserId.userId);
        socket.leave(roomId);
        userRooms.delete(socketWithUserId.userId);

        const players = await getRoomPlayers(roomId);
        if (players.length === 0) {
          removeGame(roomId);
          rematchRequests.delete(roomId);
          await query("DELETE FROM rooms WHERE id = ?", [roomId]);
        } else {
          // Get room info and update status
          const room = (await query("SELECT status, game_type FROM rooms WHERE id = ?", [
            roomId,
          ])) as Array<{ status: string; game_type: string }>;
          
          if (room.length > 0) {
            const wasPlaying = room[0].status === "playing";
            
            // Update room status to waiting if it was playing
            if (wasPlaying) {
              await updateRoomStatus(roomId, "waiting");
            }

            // Get or initialize game state for remaining player
            let game = getGame(roomId);
            if (!game) {
              game = initializeGame(room[0].game_type as GameType);
              setGame(roomId, game);
            }
            const gameState = getGameState(game);

            // Get betting info
            const bettingInfo = await getRoomBettingInfo(roomId);

            // Notify remaining player(s) with updated state
            io.to(roomId).emit("player_left", {
              userId: socketWithUserId.userId,
              roomId,
              players,
            });

            // Send waiting_for_player event with full state so remaining player can continue
            io.to(roomId).emit("waiting_for_player", {
              roomId,
              players,
              gameState,
              canMove: false, // Disable moves until new player joins
            });
          }
        }
      } catch (error) {
        logger.error(error, "Error in leave_room");
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      logger.info({ socketId: socket.id }, "User disconnected");
      activeWSConnectionsGauge.dec();

      const socketWithUserId = socket as Socket & { userId?: string };
      const userId = socketWithUserId.userId || socketToUser.get(socket.id);
      
      // Clean up session tracking
      if (userId) {
        // Only remove if this socket is the current active session
        const currentSocketId = userSessions.get(userId);
        if (currentSocketId === socket.id) {
          userSessions.delete(userId);
        }
        socketToUser.delete(socket.id);
        
        const roomId = userRooms.get(userId);
        if (roomId) {
          await removePlayerFromRoom(roomId, userId);
          userRooms.delete(userId);

          const players = await getRoomPlayers(roomId);
          if (players.length === 0) {
            removeGame(roomId);
            rematchRequests.delete(roomId);
            await query("DELETE FROM rooms WHERE id = ?", [roomId]);
          } else {
            // Get room info and update status
            const room = (await query("SELECT status, game_type FROM rooms WHERE id = ?", [
              roomId,
            ])) as Array<{ status: string; game_type: string }>;
            
            if (room.length > 0) {
              const wasPlaying = room[0].status === "playing";
              
              // Update room status to waiting if it was playing
              if (wasPlaying) {
                await updateRoomStatus(roomId, "waiting");
              }

              // Get or initialize game state for remaining player
              let game = getGame(roomId);
              if (!game) {
                game = initializeGame(room[0].game_type as GameType);
                setGame(roomId, game);
              }
              const gameState = getGameState(game);

              // Get betting info
              const bettingInfo = await getRoomBettingInfo(roomId);

              // Notify remaining player(s) with updated state
              io.to(roomId).emit("player_left", {
                userId,
                roomId,
                players,
              });

              // Send waiting_for_player event with full state so remaining player can continue
              io.to(roomId).emit("waiting_for_player", {
                roomId,
                players,
                gameState,
                canMove: false, // Disable moves until new player joins
              });
            }
          }
        }
      }
    });
  });
};

