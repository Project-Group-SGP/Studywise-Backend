import { Server, Socket } from "socket.io";

// Store active participants in each group call
// Map<groupId, Set<socketId>> where groupId is the group id and Set<socketId> is the set of socket ids of participants in the group call
export const groupCallParticipants = new Map();

export const handleCallEvents = (io: Server, socket: Socket) => {
  // Handle user joining a group call
  socket.on("joinGroupCall", ({ groupId, userId }) => {
    // Check if call exists
    if (!groupCallParticipants.has(groupId)) {
      groupCallParticipants.set(groupId, new Map());
    }

    // Store more detailed participant info
    groupCallParticipants.get(groupId).set(socket.id, {
      userId,
      joinedAt: Date.now(),
    });

    // Send existing participants with their user info
    const participants = Array.from(
      groupCallParticipants.get(groupId).entries() as IterableIterator<
        [string, { userId: string; joinedAt: number }]
      >
    ).map(([socketId, data]) => ({
      socketId,
      userId: data.userId,
    }));

    socket.emit("existingParticipants", participants);
    socket.to(groupId).emit("userJoinedCall", {
      userId,
      socketId: socket.id,
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
    console.log(
      `Received offer from ${senderId} for ${receiverId} in group ${groupId}`
    );
    // Add error handling
    if (!groupCallParticipants.get(groupId)?.has(receiverId)) {
      socket.emit("error", "Recipient not found in call");
      return;
    }
    socket.to(receiverId).emit("offer", {
      offer,
      senderId: socket.id,
    });
  });

  // Handle WebRTC answer (sent in response to an offer)
  socket.on("answer", ({ groupId, answer, senderId, receiverId }) => {
    console.log(
      `Received answer from ${senderId} for ${receiverId} in group ${groupId}`
    );

    // Forward the answer to the specific receiver

    socket.to(receiverId).emit("answer", {
      answer,
      senderId: socket.id,
    });
  });

  // Handle ICE candidates (for establishing peer connections)
  socket.on("iceCandidate", ({ groupId, candidate, senderId, receiverId }) => {
    console.log(
      `Received ICE candidate from ${senderId} for ${receiverId} in group ${groupId}`
    );

    // Forward the ICE candidate to the specific receiver
    socket.to(receiverId).emit("iceCandidate", {
      candidate,
      senderId: socket.id,
    });
  });
};
