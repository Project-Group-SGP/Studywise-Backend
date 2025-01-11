import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import session from "express-session";
import { GoogleUserPayload, TokenPayload } from "./types";
import cookieParser from "cookie-parser";
import { generateToken } from "./utils/jwt";
//@ts-ignore
import cors from "cors";
import { authenticateToken } from "./middleware/auth";
import { db } from "./prismaClient";
import { getUserByEmail } from "./lib/user";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173", // Update with your frontend URL
    credentials: true,
  })
);
const port = process.env.PORT || 3000;

// Google OAuth setup
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  throw new Error("Missing required environment variables for Google OAuth");
}

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Middleware for sessions
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET environment variable");
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// Routes
app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

// Route to initiate Google login
app.get("/auth/google", (_req: Request, res: Response) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
  });
  res.redirect(authUrl);
});

app.get(
  "/auth/google/callback",
  //@ts-ignore
  async (req: Request, res: Response, next: NextFunction) => {
    const code = req.query.code;
    if (typeof code !== "string") {
      return res.status(400).send("Invalid code provided.");
    }

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      if (!tokens.id_token) {
        throw new Error("No ID token received");
      }

      const ticket = await oAuth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: CLIENT_ID,
      });

      console.log(ticket);
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error("Failed to get payload from ID token");
      }

      const userPayload: GoogleUserPayload = {
        email: payload.email || "",
        name: payload.name || "",
        picture: payload.picture || "",
      };
      console.log("SARTHAK\n\n");

      console.log(userPayload);

      let user = await getUserByEmail(userPayload.email);
      if (!user) {
        user = await db.user.create({
          data: {
            email: userPayload.email,
            name: userPayload.name,
            avatarUrl: userPayload.picture,
            createdAt: new Date(),
          },
        });
      }

      const tokenPayload: TokenPayload = {
        ...userPayload,
        id: user.id,
      };

      // Generate JWT token
      const token = generateToken(tokenPayload);

      // Set token in HTTP-only cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Redirect to frontend groups page
      res.redirect(
        `${process.env.FRONTEND_URL || "http://localhost:5173"}/groups`
      );
    } catch (error) {
      console.error(error);
      res.status(500).send("Authentication failed.");
    }
  }
);

// Protected route example
//@ts-ignore
app.get("/me", authenticateToken, (req: Request, res: Response) => {
  //@ts-ignore
  res.json(req.user);
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
