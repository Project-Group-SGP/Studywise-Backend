import { Server } from "socket.io";
import { handleChatEvents } from "./handlers/chatHandler";
import { handleCallEvents, groupCallParticipants } from "./handlers/callHandler";
import { handleSessionEvents, sessionParticipants } from "./handlers/sessionHandler";

export const initializeSocket = (io: Server) => {
  io.on("connection", (socket) => {
    console.log("a user connected", socket.id);

    // Initialize all handlers
    handleChatEvents(io, socket);
    handleCallEvents(io, socket);
    handleSessionEvents(io, socket);
    

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log("user disconnected", socket.id);

      // Clean up group calls
      groupCallParticipants.forEach((participants, groupId) => {
        if (participants.has(socket.id)) {
          participants.delete(socket.id);
          socket.to(groupId).emit("userLeftCall", { socketId: socket.id });
        }
      });

      // Clean up sessions
      sessionParticipants.forEach((participants, sessionId) => {
        if (participants.has(socket.id)) {
          const participant = participants.get(socket.id);
          participants.delete(socket.id);
          socket.to(sessionId).emit("userLeftSession", {
            socketId: socket.id,
            userId: participant?.userId,
            userName: participant?.userName,
          });
        }
      });
    });
  });
}; 