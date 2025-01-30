import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import session from "express-session";
//@ts-ignore
import cors from "cors";
import { createServer } from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import groupRouter from "./api/group/index";
import { setupPushSubscriptionRoutes } from "./api/push-subscription";
import sessionRouter from "./api/session/index";
import { setupAuthRoutes } from "./auth/route";
import { authenticateToken } from "./middleware/auth";
import { db } from "./prismaClient";

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

      // console.log("Received message:", data);

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

      // Broadcast the message to all clients in the group
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

  // WebRTC Signaling for group calls
  socket.on("offer", ({ groupId, offer, senderId }) => {
    console.log(`Received offer from ${senderId} for group ${groupId}`);
    // Broadcast the offer to all participants in the group
    socket.to(groupId).emit("offer", { offer, senderId });
  });

  socket.on("answer", ({ groupId, answer, senderId }) => {
    console.log(`Received answer from ${senderId} for group ${groupId}`);
    // Broadcast the answer to the offer sender
    socket.to(groupId).emit("answer", { answer, senderId });
  });

  socket.on("iceCandidate", ({ groupId, candidate, senderId }) => {
    console.log(`Received ICE candidate from ${senderId} for group ${groupId}`);
    // Broadcast the ICE candidate to all participants
    socket.to(groupId).emit("iceCandidate", { candidate, senderId });
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

// session routes
app.use("/api/sessions", sessionRouter);

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

// Protected route example
//@ts-ignore
app.get("/me", authenticateToken, (req: Request, res: Response) => {
  //@ts-ignore
  res.json(req.user);
});

// Setup auth routes
setupAuthRoutes(app);

// Setup push subscription routes
setupPushSubscriptionRoutes(app);

httpServer.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
