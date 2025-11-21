import passport from "passport";
import { query } from "../db/connection.js";
import { v4 as uuidv4 } from "uuid";
import { createRequire } from "module";
import { checkAndAutoBanUser } from "../utils/banManager.js";

// Use createRequire to import CommonJS module in ES module context
const require = createRequire(import.meta.url);
const GoogleTokenStrategy = require("passport-google-token").Strategy;

interface GoogleProfile {
  id: string;
  name?: {
    givenName?: string;
    familyName?: string;
  };
  emails?: Array<{ value: string }>;
  _json?: {
    picture?: string;
  };
}

interface User {
  id: string;
  email: string;
  username: string;
  user_type: string;
  oauth_provider: string;
  oauth_id: string;
  profile_picture: string | null;
}

passport.use(
  new GoogleTokenStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: GoogleProfile,
      cb: (error: Error | null, user?: User | null) => void,
    ) => {
      try {
        // Validate required profile data
        if (!profile || !profile.id || !profile.emails || !profile.emails[0]) {
          return cb(new Error("Invalid Google profile data") as Error, null);
        }

        const email = profile.emails[0].value;
        const fullName = `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim() || "Unknown User";
        const picture = profile._json?.picture || null;
        const googleId = profile.id;

        // Check if user already exists by email or oauth_id
        const existingUsers = (await query(
          `SELECT id, email, username, user_type, oauth_provider, oauth_id, profile_picture 
           FROM users 
           WHERE email = ? OR (oauth_provider = 'google' AND oauth_id = ?)`,
          [email, googleId],
        )) as User[];

        let user: User;

        if (existingUsers.length > 0) {
          // User exists - update OAuth info if needed
          user = existingUsers[0];

          // Update OAuth info if not set or different
          if (!user.oauth_provider || user.oauth_provider !== "google" || user.oauth_id !== googleId) {
            await query(
              `UPDATE users 
               SET oauth_provider = 'google', oauth_id = ?, email = ?, profile_picture = ?
               WHERE id = ?`,
              [googleId, email, picture, user.id],
            );
            user.oauth_provider = "google";
            user.oauth_id = googleId;
            user.email = email;
            user.profile_picture = picture;
          } else if (user.profile_picture !== picture) {
            // Update profile picture if changed
            await query(`UPDATE users SET profile_picture = ? WHERE id = ?`, [picture, user.id]);
            user.profile_picture = picture;
          }

          // Check and auto-ban if user has 5+ reports
          const isBanned = await checkAndAutoBanUser(user.id);
          if (isBanned) {
            return cb(new Error("Account is banned") as Error, null);
          }

          console.log("User already exists:", user.email);
        } else {
          // Create new user
          const userId = uuidv4();
          // Generate a username from email (before @) or use a default
          let baseUsername = email.split("@")[0].substring(0, 20).replace(/[^a-zA-Z0-9_-]/g, "_");
          if (!baseUsername || baseUsername.length < 3) {
            baseUsername = `user_${userId.substring(0, 8)}`;
          }
          
          // Check if username already exists and make it unique if needed
          let username = baseUsername;
          let counter = 1;
          while (true) {
            const existingUsername = (await query(
              "SELECT id FROM users WHERE username = ?",
              [username],
            )) as Array<{ id: string }>;
            
            if (existingUsername.length === 0) {
              break; // Username is available
            }
            
            // Append counter to make it unique
            const suffix = `_${counter}`;
            const maxLength = 20 - suffix.length;
            username = baseUsername.substring(0, maxLength) + suffix;
            counter++;
            
            // Safety check to prevent infinite loop
            if (counter > 1000) {
              username = `user_${userId.substring(0, 8)}_${Date.now()}`;
              break;
            }
          }

          await query(
            `INSERT INTO users (id, username, email, oauth_provider, oauth_id, profile_picture, username_set, user_type)
             VALUES (?, ?, ?, 'google', ?, ?, TRUE, 'user')`,
            [userId, username, email, googleId, picture],
          );

          user = {
            id: userId,
            email,
            username,
            user_type: "user",
            oauth_provider: "google",
            oauth_id: googleId,
            profile_picture: picture,
          };

          console.log("User created:", user.email);
        }

        // Return the user
        return cb(null, user);
      } catch (err: any) {
        console.log("error signing up", err);
        return cb(err, null);
      }
    },
  ),
);

passport.serializeUser((user: any, cb) => {
  cb(null, user.id);
});

passport.deserializeUser(async (id: string, cb) => {
  try {
    const users = (await query(
      `SELECT id, email, username, user_type, oauth_provider, oauth_id, profile_picture 
       FROM users WHERE id = ?`,
      [id],
    )) as User[];

    if (users.length > 0) {
      cb(null, users[0]);
    } else {
      cb(new Error("User not found"), null);
    }
  } catch (err: any) {
    console.log("error deserializing", err);
    cb(err, null);
  }
});

export default passport;

