# Frontend-Backend Integration Guide

## Changes Made

### 1. Socket Configuration (`src/utils/socket.ts`)
- Updated to connect to `http://localhost:3001` (backend)
- Updated event names to match backend:
  - `join_random` → matches backend
  - `join_keyword` → matches backend
  - `player_move` → matches backend
  - `chat_message` → matches backend
  - `rematch_request` → matches backend

### 2. Vite Config (`vite.config.ts`)
- Added server configuration:
  - Port: 3000
  - Host: true (listens on all interfaces)
  - Proxy for `/socket.io` to backend (port 3001)

### 3. App.tsx
- Added user connection handling
- Added `connectUser` function
- Listens for `connected` event from backend

### 4. Home.tsx
- Added username input screen
- Converts game types: `tic-tac-toe` → `tic_tac_toe` for backend
- Handles `game_start` and `waiting_for_player` events

## Game Type Mapping

Frontend uses kebab-case, backend uses snake_case:
- `tic-tac-toe` → `tic_tac_toe`
- `checkers` → `checkers` (same)
- `chess` → `chess` (same)

## Next Steps

1. Update `GameRoom.tsx` to:
   - Listen for `game_start`, `move_update`, `game_over` events
   - Pass game state to `GameBoard` component
   - Handle moves from `GameBoard`

2. Update `GameBoard.tsx` to:
   - Render actual game boards (TicTacToe, Checkers, Chess)
   - Handle user moves
   - Display game state

3. Update `ChatPanel.tsx` to:
   - Listen for `chat_message` events from socket
   - Display messages from backend

4. Update `VideoPanel.tsx` to:
   - Use WebRTC utilities from `src/utils/webrtc.ts`
   - Handle WebRTC signaling events

## Socket Events Reference

### Client → Server
- `user_connect` - Connect user with username
- `join_random` - Join random match
- `join_keyword` - Join by keyword
- `player_move` - Send game move
- `chat_message` - Send chat message
- `rematch_request` - Request rematch
- `webrtc_offer` - WebRTC offer
- `webrtc_answer` - WebRTC answer
- `webrtc_ice_candidate` - WebRTC ICE candidate

### Server → Client
- `connected` - User connected (returns userId, username)
- `game_start` - Game started
- `waiting_for_player` - Waiting for opponent
- `move_update` - Game state updated
- `game_over` - Game finished
- `new_match_start` - Rematch started
- `chat_message` - Chat message received
- `player_left` - Opponent left

