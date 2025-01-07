import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import session from "express-session";
import { GoogleUserPayload } from "./types";
//@ts-ignore
import cors from "cors";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
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

// Callback route
app.get(
  "/auth/google/callback",
  //@ts-ignore
  (req: Request, res: Response, next: NextFunction) => {
    const code = req.query.code;
    if (typeof code !== "string") {
      return res.status(400).send("Invalid code provided.");
    }

    oAuth2Client
      .getToken(code)
      .then(({ tokens }) => {
        oAuth2Client.setCredentials(tokens);

        if (!tokens.id_token) {
          throw new Error("No ID token received");
        }

        return oAuth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: CLIENT_ID,
        });
      })
      .then((ticket) => {
        const payload = ticket.getPayload();
        if (!payload) {
          throw new Error("Failed to get payload from ID token");
        }

        const userPayload: GoogleUserPayload = {
          email: payload.email || "",
          email_verified: payload.email_verified || false,
          name: payload.name || "",
          picture: payload.picture || "",
          given_name: payload.given_name || "",
          family_name: payload.family_name || "",
          locale: payload.locale || "",
        };

        req.session.user = userPayload;
        res.redirect("/dashboard"); // Redirect to the frontend dashboard or home page
      })
      .catch((error) => {
        console.error(error);
        res.status(500).send("Authentication failed.");
      });
  }
);

// Get logged-in user details
app.get("/me", (req: Request, res: Response) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).send("Not logged in.");
  }
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
