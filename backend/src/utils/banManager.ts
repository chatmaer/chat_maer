import { query } from "../db/connection.js";
import logger from "../lib/logger.js";

/**
 * Checks if a user has 5+ reports and auto-bans them if not already banned
 * @param userId - The user ID to check
 * @returns true if user is banned (either was already banned or just got banned), false otherwise
 */
export async function checkAndAutoBanUser(userId: string): Promise<boolean> {
  try {
    const userData = (await query(
      "SELECT report_count, is_banned FROM users WHERE id = ?",
      [userId],
    )) as Array<{ report_count: number; is_banned: boolean }>;

    if (userData.length === 0) {
      return false;
    }

    const { report_count, is_banned } = userData[0];

    // If user already has 5+ reports but is not banned, auto-ban them
    if (report_count >= 5 && !is_banned) {
      await query(
        `UPDATE users 
         SET is_banned = TRUE, banned_at = NOW(), ban_reason = ?
         WHERE id = ?`,
        [
          `Account banned due to ${report_count} reports`,
          userId,
        ],
      );

      logger.info(
        `User ${userId} auto-banned due to ${report_count} reports (existing reports)`,
      );
      return true;
    }

    return is_banned;
  } catch (error) {
    logger.error(error, "Error checking and auto-banning user");
    return false;
  }
}

