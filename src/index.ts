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

// Store active participants in each group call
const groupCallParticipants = new Map(); // Map<groupId, Set<socketId>>

io.on("connection", (socket) => {
  console.log("a user connected", socket.id);

  // Handle joining chat groups
  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
    console.log(`User ${socket.id} joined group ${groupId}`);
  });

  // Chat message handling
  socket.on("sendMessage", async (data) => {
    try {
      const { content, groupId, userId } = data;

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

  // Typing indicators
  socket.on("typing", (data) => {
    const { groupId, userId, userName } = data;
    socket.to(groupId).emit("typing", { userId, userName });
  });

  socket.on("stopTyping", (data) => {
    const { groupId, userId, userName } = data;
    socket.to(groupId).emit("stopTyping", { userId, userName });
  });

  // WebRTC Group Call Signaling

  // Handle user joining a group call
  socket.on("joinGroupCall", ({ groupId, userId }) => {
    // Check if call exists
    if (!groupCallParticipants.has(groupId)) {
      groupCallParticipants.set(groupId, new Map());
    }
    
    // Store more detailed participant info
    groupCallParticipants.get(groupId).set(socket.id, {
      userId,
      joinedAt: Date.now()
    });
    
    // Send existing participants with their user info
    const participants = Array.from(groupCallParticipants.get(groupId).entries() as [string, { userId: string; joinedAt: number }][])
      .map(([socketId, data]) => ({
        socketId,
        userId: data.userId
      }));
    
    socket.emit("existingParticipants", participants);
    socket.to(groupId).emit("userJoinedCall", { 
      userId,
      socketId: socket.id
    });
  });

  // Handle user leaving a group call
  socket.on("leaveGroupCall", ({ groupId }) => {
    if (groupCallParticipants.has(groupId)) {
      groupCallParticipants.get(groupId).delete(socket.id);
      // Notify others that user left the call
      socket.to(groupId).emit("userLeftCall", { socketId: socket.id });
    }
  });

  // Handle WebRTC offer (sent when initiating a connection with a new participant)
  socket.on("offer", ({ groupId, offer, senderId, receiverId }) => {
    console.log(`Received offer from ${senderId} for ${receiverId} in group ${groupId}`);
    // Add error handling
    if (!groupCallParticipants.get(groupId)?.has(receiverId)) {
      socket.emit("error", "Recipient not found in call");
      return;
    }
    socket.to(receiverId).emit("offer", { 
      offer,
      senderId: socket.id
    });
  });

  // Handle WebRTC answer (sent in response to an offer)
  socket.on("answer", ({ groupId, answer, senderId, receiverId }) => {
    console.log(`Received answer from ${senderId} for ${receiverId} in group ${groupId}`);
    // Forward the answer to the specific receiver
    socket.to(receiverId).emit("answer", { 
      answer,
      senderId: socket.id
    });
  });

  // Handle ICE candidates (for establishing peer connections)
  socket.on("iceCandidate", ({ groupId, candidate, senderId, receiverId }) => {
    console.log(`Received ICE candidate from ${senderId} for ${receiverId} in group ${groupId}`);
    // Forward the ICE candidate to the specific receiver
    socket.to(receiverId).emit("iceCandidate", { 
      candidate,
      senderId: socket.id
    });
  });

  // Handle disconnections
  socket.on("disconnect", () => {
    console.log("user disconnected", socket.id);
    // Remove user from all group calls they were part of
    groupCallParticipants.forEach((participants, groupId) => {
      if (participants.has(socket.id)) {
        participants.delete(socket.id);
        // Notify others in the group call
        socket.to(groupId).emit("userLeftCall", { socketId: socket.id });
      }
    });
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
