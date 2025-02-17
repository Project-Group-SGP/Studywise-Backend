import { Server, Socket } from "socket.io";
import { db } from "../../prismaClient";

// Add storage for session participants
// Map<sessionId, Map<socketId, userInfo>>
export const sessionParticipants = new Map();

export const handleSessionEvents = (io: Server, socket: Socket) => {
  // Add these socket events inside the connection handler
  socket.on("startSession", async ({ sessionId }) => {
    try {
      const session = await db.session.update({
        where: { id: sessionId },
        data: {
          isStarted: true,
          startedAt: new Date(),
        },
      });

      // Notify all participants in the session
      io.to(sessionId).emit("sessionStarted", {
        sessionId,
        startedAt: session.startedAt,
      });
    } catch (error) {
      console.error("Error starting session:", error);
      socket.emit("error", "Failed to start session");
    }
  });

  // Session-related socket events -> sessionId, userId, userName
  socket.on("joinSession", ({ sessionId, userId, userName }) => {
    socket.join(sessionId);

    // Initialize session participants if not exists
    if (!sessionParticipants.has(sessionId)) {
      sessionParticipants.set(sessionId, new Map());
    }

    // Store participant information
    sessionParticipants.get(sessionId).set(socket.id, {
      userId,
      userName,
      joinedAt: Date.now(),
    });

    // Get all current participants in the session
    const participants = Array.from(
      sessionParticipants.get(sessionId).entries()
    ).map((entry) => {
      const [socketId, data] = entry as [
        string,
        { userId: string; userName: string; joinedAt: number }
      ];
      return {
        socketId,
        userId: data.userId,
        userName: data.userName,
        joinedAt: data.joinedAt,
      };
    });
    // Send existing participants to the new joiner
    socket.emit("sessionParticipants", participants);

    // Notify others about the new participant
    socket.to(sessionId).emit("userJoinedSession", {
      socketId: socket.id,
      userId,
      userName,
      joinedAt: Date.now(),
    });

    console.log(`User ${userName} (${socket.id}) joined session ${sessionId}`);
  });

  // Handle user leaving a session -> sessionId
  socket.on("leaveSession", ({ sessionId }) => {
    if (sessionParticipants.has(sessionId)) {
      const participant = sessionParticipants.get(sessionId).get(socket.id);
      sessionParticipants.get(sessionId).delete(socket.id);

      // Notify others that user left the session
      socket.to(sessionId).emit("userLeftSession", {
        socketId: socket.id,
        userId: participant?.userId,
        userName: participant?.userName,
      });
    }
    socket.leave(sessionId);
  });

  // endSession event handler
  socket.on("endSession", async ({ sessionId }) => {
    try {
      const session = await db.session.update({
        where: { id: sessionId },
        data: {
          endedAt: new Date(),
        },
      });
      // Notify all participants in the session
      io.to(sessionId).emit("sessionEnded", {
        sessionId,
        endedAt: session.endedAt,
      });

      // Clean up session participants
      sessionParticipants.delete(sessionId);
    } catch (error) {
      console.error("Error ending session:", error);
      socket.emit("error", "Failed to end session");
    }
  });

};
