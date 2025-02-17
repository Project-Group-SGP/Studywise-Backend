import { Server, Socket } from "socket.io";
import { db } from "../../prismaClient";

export const handleChatEvents = (io: Server, socket: Socket) => {
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
        data: { content, groupId, userId },
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
};
