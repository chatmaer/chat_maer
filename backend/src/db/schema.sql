-- Database: real_skills

CREATE DATABASE IF NOT EXISTS real_skills;
USE real_skills;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    session_id VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    coins INT DEFAULT 100,
    balance DECIMAL(10, 2) DEFAULT 0.00 COMMENT 'Balance in Brazilian Real (BRL)',
    -- OAuth fields for Google authentication
    oauth_provider ENUM('google') NULL,
    oauth_id VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    profile_picture VARCHAR(500) NULL,
    -- Account status
    is_banned BOOLEAN DEFAULT FALSE,
    banned_at DATETIME NULL,
    ban_reason TEXT NULL,
    report_count INT DEFAULT 0,
    -- Username set flag (always true for username-based login)
    username_set BOOLEAN DEFAULT FALSE,
    -- Display username for rooms/chatting (second step username, used in game rooms)
    display_username VARCHAR(50) NULL COMMENT 'Display username used in rooms, chat, and video (second step username)',
    -- Pix key for withdrawals
    pix_key VARCHAR(255) NULL COMMENT 'User Pix key (CPF, email, phone, or random key)',
    -- User type/role
    user_type ENUM('user', 'admin') DEFAULT 'user',
    INDEX idx_session_id (session_id),
    INDEX idx_oauth (oauth_provider, oauth_id),
    INDEX idx_email (email),
    INDEX idx_is_banned (is_banned),
    INDEX idx_balance (balance),
    INDEX idx_user_type (user_type),
    UNIQUE KEY unique_oauth (oauth_provider, oauth_id)
);

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(36) PRIMARY KEY,
    keyword VARCHAR(50) NULL,
    game_type ENUM('tic_tac_toe', 'checkers', 'chess') NOT NULL,
    status ENUM('waiting', 'playing', 'finished') DEFAULT 'waiting',
    betting_amount DECIMAL(10, 2) DEFAULT 0.25 COMMENT 'Betting amount in Brazilian Real (BRL)',
    betting_status ENUM('unlocked', 'locked') DEFAULT 'unlocked' COMMENT 'Whether betting amount can be changed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_keyword (keyword),
    INDEX idx_status (status),
    INDEX idx_game_type (game_type),
    INDEX idx_game_status (game_type, status),
    INDEX idx_status_game (status, game_type),
    INDEX idx_betting_status (betting_status)
);

-- Room players table
CREATE TABLE IF NOT EXISTS room_players (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    is_host BOOLEAN DEFAULT FALSE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_room_user (room_id, user_id),
    INDEX idx_room_id (room_id),
    INDEX idx_user_id (user_id),
    INDEX idx_room_user (room_id, user_id)
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    game_type ENUM('tic_tac_toe', 'checkers', 'chess') NOT NULL,
    winner_id VARCHAR(36),
    moves_json TEXT,
    result ENUM('win', 'draw', 'loss'),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_room_id (room_id),
    INDEX idx_winner_id (winner_id)
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_room_id (room_id),
    INDEX idx_created_at (created_at)
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(36) PRIMARY KEY,
    reported_user_id VARCHAR(36) NOT NULL,
    reporter_user_id VARCHAR(36) NOT NULL,
    room_id VARCHAR(36) NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
    INDEX idx_reported_user (reported_user_id),
    INDEX idx_reporter_user (reporter_user_id),
    INDEX idx_room_id (room_id),
    INDEX idx_created_at (created_at),
    -- Prevent duplicate reports from same reporter for same user
    UNIQUE KEY unique_report (reported_user_id, reporter_user_id, room_id)
);

-- Betting proposals table (tracks proposals for changing betting amount)
CREATE TABLE IF NOT EXISTS betting_proposals (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    proposer_user_id VARCHAR(36) NOT NULL,
    proposed_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'accepted', 'rejected', 'expired') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (proposer_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_room_id (room_id),
    INDEX idx_proposer_user_id (proposer_user_id),
    INDEX idx_status (status)
);

-- Betting transactions table (tracks all betting-related transactions)
CREATE TABLE IF NOT EXISTS betting_transactions (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    match_id VARCHAR(36) NULL,
    user_id VARCHAR(36) NOT NULL,
    transaction_type ENUM('bet_placed', 'bet_won', 'bet_lost', 'refund', 'platform_fee') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    balance_before DECIMAL(10, 2) NOT NULL,
    balance_after DECIMAL(10, 2) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_room_id (room_id),
    INDEX idx_user_id (user_id),
    INDEX idx_match_id (match_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at)
);

-- Pix transactions table (tracks Pix deposits and withdrawals)
CREATE TABLE IF NOT EXISTS pix_transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    transaction_type ENUM('deposit', 'withdrawal') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    pix_key VARCHAR(255) NULL COMMENT 'Pix key for withdrawal or deposit',
    pix_transaction_id VARCHAR(255) NULL COMMENT 'External Pix transaction ID from provider',
    qr_code TEXT NULL COMMENT 'QR code data for deposit',
    qr_code_expires_at DATETIME NULL COMMENT 'QR code expiration time',
    balance_before DECIMAL(10, 2) NULL COMMENT 'Balance before transaction (for deposits)',
    balance_after DECIMAL(10, 2) NULL COMMENT 'Balance after transaction',
    error_message TEXT NULL COMMENT 'Error message if transaction failed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at),
    INDEX idx_pix_transaction_id (pix_transaction_id)
);

