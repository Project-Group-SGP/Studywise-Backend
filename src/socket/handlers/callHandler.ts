import { Server, Socket } from "socket.io";

// Store active participants in each group call with more detailed information
// Map<groupId, Map<socketId, ParticipantInfo>>
interface ParticipantInfo {
  userId: string;
  userName: string;
  joinedAt: number;
}

export const groupCallParticipants = new Map<string, Map<string, ParticipantInfo>>();

export const handleCallEvents = (io: Server, socket: Socket) => {
  // Handle user joining a group call
  socket.on("joinGroupCall", ({ groupId, userId, userName }) => {
    try {
      console.log(`[Call] ${userName} joining call in group ${groupId}`);
      
      if (!groupCallParticipants.has(groupId)) {
        groupCallParticipants.set(groupId, new Map());
        console.log(`[Call] Created new call for group ${groupId}`);
      }

      const participantInfo: ParticipantInfo = {
        userId,
        userName,
        joinedAt: Date.now()
      };

      groupCallParticipants.get(groupId)?.set(socket.id, participantInfo);

      // Join the socket to the group room
      socket.join(groupId);

      // Get current participants
      const participants = Array.from(
        groupCallParticipants.get(groupId)?.entries() || []
      ).map(([socketId, data]) => ({
        socketId,
        userId: data.userId,
        userName: data.userName
      }));

      console.log(`[Call] Current participants in group ${groupId}:`, 
        participants.map(p => p.userName).join(', ')
      );
      
      // Send existing participants to the new user
      socket.emit("existingParticipants", participants);

      // Notify others about the new participant
      socket.to(groupId).emit("userJoinedCall", {
        socketId: socket.id,
        userId,
        userName
      });
    } catch (error) {
      console.error(`[Call] Error in joinGroupCall:`, error);
      socket.emit("error", "Failed to join call");
    }
  });

  // Handle user leaving a group call
  socket.on("leaveGroupCall", ({ groupId, userId, userName }) => {
    try {
      console.log(`[Call] ${userName} leaving call in group ${groupId}`);
      
      if (groupCallParticipants.has(groupId)) {
        const participants = groupCallParticipants.get(groupId);
        participants?.delete(socket.id);

        // Notify others about the participant leaving
        socket.to(groupId).emit("userLeftCall", {
          socketId: socket.id,
          userId,
          userName
        });
        
        const remainingParticipants = participants?.size || 0;
        console.log(`[Call] Remaining participants in group ${groupId}: ${remainingParticipants}`);
        
        // Clean up empty calls
        if (remainingParticipants === 0) {
          groupCallParticipants.delete(groupId);
          console.log(`[Call] Removed empty call for group ${groupId}`);
        }
      }

      // Leave the socket room
      socket.leave(groupId);
    } catch (error) {
      console.error(`[Call] Error in leaveGroupCall:`, error);
    }
  });

  // Handle WebRTC signaling
  socket.on("offer", ({ groupId, offer, receiverId, senderName, receiverName }) => {
    try {
      console.log(`[Call] Offer from ${senderName} to ${receiverName} in group ${groupId}`);
      
      const participants = groupCallParticipants.get(groupId);
      if (!participants?.has(receiverId)) {
        console.warn(`[Call] Recipient ${receiverName} not found in call`);
        socket.emit("error", "Recipient not found in call");
        return;
      }

      socket.to(receiverId).emit("offer", {
        offer,
        senderId: socket.id,
        senderName
      });
      console.log(`[Call] Offer forwarded to ${receiverName}`);
    } catch (error) {
      console.error(`[Call] Error in handling offer:`, error);
      socket.emit("error", "Failed to process offer");
    }
  });

  // Add back answer event with names
  socket.on("answer", ({ groupId, answer, receiverId, senderName, receiverName }) => {
    try {
      console.log(`[Call] Answer from ${senderName} to ${receiverName} in group ${groupId}`);
      
      socket.to(receiverId).emit("answer", {
        answer,
        senderId: socket.id,
        senderName
      });
      console.log(`[Call] Answer forwarded to ${receiverName}`);
    } catch (error) {
      console.error(`[Call] Error in handling answer:`, error);
      socket.emit("error", "Failed to process answer");
    }
  });

  // Add back ICE candidate event with names
  socket.on("iceCandidate", ({ groupId, candidate, receiverId, senderName, receiverName }) => {
    try {
      console.log(`[Call] ICE candidate from ${senderName} to ${receiverName} in group ${groupId}`);
      
      socket.to(receiverId).emit("iceCandidate", {
        candidate,
        senderId: socket.id,
        senderName
      });
      console.log(`[Call] ICE candidate forwarded to ${receiverName}`);
    } catch (error) {
      console.error(`[Call] Error in handling ICE candidate:`, error);
      socket.emit("error", "Failed to process ICE candidate");
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    try {
      // Find and remove participant from all group calls
      for (const [groupId, participants] of groupCallParticipants.entries()) {
        const participant = participants.get(socket.id);
        if (participant) {
          participants.delete(socket.id);
          
          // Notify others in the group
          socket.to(groupId).emit("userLeftCall", {
            socketId: socket.id,
            userId: participant.userId,
            userName: participant.userName
          });

          // Clean up empty calls
          if (participants.size === 0) {
            groupCallParticipants.delete(groupId);
            console.log(`[Call] Removed empty call for group ${groupId}`);
          }
        }
      }
    } catch (error) {
      console.error(`[Call] Error handling disconnect:`, error);
    }
  });
};