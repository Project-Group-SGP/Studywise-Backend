import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import session from "express-session";
import {
  GoogleUserPayload,
  pushSubscriptionSchema,
  TokenPayload,
} from "./types";
import cookieParser from "cookie-parser";
import { generateToken } from "./utils/jwt";
//@ts-ignore
import cors from "cors";
import { authenticateToken } from "./middleware/auth";
import { db } from "./prismaClient";
import { getUserByEmail } from "./lib/user";
import z from "zod";
import groupRouter from "./api/group/index";
import morgan from "morgan";
import { Server } from "socket.io";
import { createServer } from "http";

dotenv.config();

const app = express();
const httpServer = createServer(app);


const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("a user connected", socket.id);

  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
    console.log(`User ${socket.id} joined group ${groupId}`);
  });

  socket.on("sendMessage", async (data) => {
    try {
      const { content, groupId, userId } = data;

      console.log("Received message:", data);
      
      
      const message = await db.message.create({
        data: {
          content,
          groupId,
          userId,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      });

      io.to(groupId).emit("message", message);
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("error", "Message sending failed");
    }
  });

  socket.on("typing", (data) => {
    const { groupId, userId, username } = data;
    socket.to(groupId).emit("typing", { userId, username });
  });

  socket.on("stopTyping", (data) => {
    const { groupId, userId, username } = data;
    socket.to(groupId).emit("stopTyping", { userId, username });
  });

  socket.on("disconnect", () => {
    console.log("user disconnected", socket.id);
  });
});


app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173", // Update with your frontend URL
    credentials: true,
  })
);

// group routes

app.use("/api/groups", groupRouter);
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

      // console.log(userPayload);

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

app.post("/logout", (req: Request, res: Response) => {
  try {
    // Clear the token cookie
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Send a success response or redirect
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Failed to log out" });
  }
});

// Protected route example
//@ts-ignore
app.get("/me", authenticateToken, (req: Request, res: Response) => {
  //@ts-ignore
  res.json(req.user);
});

app.post(
  "/push-subscription",
  //@ts-ignore
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const validatedData = pushSubscriptionSchema.parse(req.body);
      const { endpoint, auth, p256dh } = validatedData;
      const { id } = req.user as TokenPayload;

      const existingSubscription = await db.pushSubscription.findUnique({
        where: { endpoint },
      });

      if (existingSubscription) {
        await db.pushSubscription.update({
          where: { id: existingSubscription.id },
          data: {
            auth,
            p256dh,
          },
        });
      } else {
        await db.pushSubscription.create({
          data: {
            endpoint,
            auth,
            p256dh,
            userId: id,
          },
        });
      }

      res.status(200).json({
        message: "Push subscription created successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      console.error("Error creating push subscription:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

app.delete(
  "/push-subscription",
  //@ts-ignore
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const validatedData = pushSubscriptionSchema.parse(req.body);
      const { endpoint } = validatedData;
      const { id } = req.user as TokenPayload;
      const subscription = await db.pushSubscription.findUnique({
        where: { endpoint },
      });

      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      if (subscription.userId !== id) {
        return res
          .status(403)
          .json({ message: "Unauthorized to delete this subscription" });
      }

      await db.pushSubscription.delete({
        where: { endpoint },
      });

      res
        .status(200)
        .json({ message: "Push subscription deleted successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      console.error("Error deleting push subscription:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

httpServer.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
